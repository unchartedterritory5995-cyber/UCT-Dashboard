# Session state — `feat/indicator-r0r1`

## ⭐⭐ SESSION 2 — THE TWO AGEN DIVERGENCES, RULED AND RAILED (2026-09-12)

Owner ruled both; this is what landed.

### 1. Firing count — **ACCEPTED** as a window-depth divergence, not a bug

`divergences.json` row `hve-window-depth-fires-more-on-a-shorter-series`, status
`accepted`, evidence AGEN **4,066 vendor bars vs 6,684 ours**. Neither side is
adjusted. Its `member_hook` is a **new kind** — `requirementTag`, naming
`closedTable.json::_requirement_tags.window_dependent` — because a divergence about
how much history the CONSUMER supplies has no function to hang a `vendorNote` on and
no translator fold to disclose. The kind is declared in the shared schema and pinned
in **both** lanes (`test_vendor_truth.py` and `vendorTruth.test.js`).

### ⛔⛔ THE IMPLICATION IS THE PART THAT SHIPS — a rail on the fixture files

`tools/vendor_window.py` + `tests/test_vendor_capture_window.py`. Every vendor
capture now carries a `window_check` block, and **the rail re-derives every field of
it except `bars_loaded`**, so a capture cannot certify its own arithmetic:

| capture | bars_loaded | window | verdict | excluded |
|---|---|---|---|---|
| AGEN 1D | **4,066** | 2,751 | `FULL_WINDOW` | — |
| SPY 1D | *not read* | 2,751 | `UNMEASURED` | the four columns that need any history |

⭐ **THE WINDOW IS 2,751, NOT THE 2,500 THE INPUT DECLARES.** `maxLookback` is a tree
SUM — the input is the largest single term in `HVE Trigger`'s reach, not the whole of
it. The number is read off `tools/lookback_agreement.json`, the R-G cross-lane oracle
**both readers write**, so it is measured rather than transcribed and cannot drift
from the script.

⛔ **PER COLUMN, NEVER ALL-OR-NOTHING.** At the 1,003 bars the AGEN study actually
loaded on add, only `HVE Trigger` is unanswerable; `Volume` (window 0) and the three
50-bar columns are exactly as good as at any depth.

⛔ **AN UNREAD DEPTH IS A REFUSAL.** `UNMEASURED` excludes every column needing
history. The SPY capture sits there because it predates the ruling by hours, named in
a **closed** list in the rail — a capture taken afterwards that lands at UNMEASURED
fails by name. ⚠️ Its 50-bar columns are demonstrably fine (a 50-bar `sma` is `na`
until it has 50 bars, and they returned values) — recorded as an **observation, not
promoted to a measurement**, because the exclusion is what makes not measuring cost
something. **Owed: read `bars_loaded` off the rig and delete the entry.**

Mutation-checked five ways — stale `bars_loaded`, a transcribed 2,500, an emptied
exclusion list, the block deleted, the sha clobbered — each goes red.

### On our own side: the pane does NOT need the disclosure, and the alerts door does

Measured rather than assumed:

```
pane document trees: value 0 · out2 50 · out3 50 · out4 50   → LARGEST 50
the full output 4 "HVE Trigger" alertcondition               → 2751
FIRST_PAINT_BARS = 600 on every timeframe · fullBarsFor('D') = 12500
```

⭐ **No drawn series carries the `window_dependent` obligation**, because the
2,751-bar window belongs solely to the alertcondition **D1 removes from the pane**.
The obligation transfers to the **alerts door**, where 600 bars at first paint is
**2,151 short** — recorded there, not on the pane.

### 2. Volume values — **OPEN**, cause not established

Row `agen-historical-volume-differs-by-1-8-percent-before-2016`, status **`open`** — a
status added to the vocabulary in both places it lives (the schema and the roster's
own `_status_vocabulary`) for exactly this: **measured on both sides, cause not
established.** Deliberately not `suspected` (the numbers are in hand) and not
`confirmed` (which here means an observation EXPLAINS a delta — this explains
nothing). Like `suspected`, it may never explain a delta in the harness.

Both hypotheses stay live: adjusted volume vs consolidated-vs-primary tape. ⛔ The row
carries **no `member_hook`** and says why — it briefly wore `window_dependent`, which
describes the *other* AGEN row; a volume value that disagrees before 2016 is a
data-provenance property of the series, not of the loaded window, and stamping it on
the window tag would tell a member the wrong thing in the one place they read.

⭐ **T6 is unaffected**: recent bars agree to ~1e-6, the comparison uses the last 300
bars, and the record day itself agrees to 1.5e-7.

Two cheap checks are queued for the next rig visit (owner-authorised, T5's session if
the rig is idle): read the vendor chart's dividend/split adjustment toggles and record
them in the fixture, and re-read one pre-2016 bar with adjustment off. If that explains
it the row closes; if not it becomes a data-provenance item outside this wave.

### ⚠️ PYTHON LANE RUN 5 — 12/12 chunks, exit code read BARE

`REAL EXIT = 1`. **23,781 passed · 55 failed · 68 skipped · 10 xfailed**, no chunk
killed, every chunk with a totals line.

| chunk | result | | chunk | result |
|---|---|---|---|---|
| 1 | 2 failed, 2365 passed | | 7 | 20 failed, 2515 passed |
| 2 | 1793 passed | | 8 | 6 failed, 2153 passed |
| 3 | 2178 passed, 9 xfailed | | 9 | 1 failed, 1309 passed |
| 4 | 2756 passed, 1 xfailed | | 10 | 3 failed, 2074 passed |
| 5 | 10 failed, 1697 passed | | 11 | 6 failed, 1875 passed |
| 6 | 1703 passed | | 12 | 7 failed, 1363 passed |

**Against run 2 (41 failed / 23,773 passed): +16 new, −2 gone.** And the 16 are not
16 regressions:

- **5 are `test_vendor_truth.py`** — the run snapshotted the tree at 18:31–18:40 while
  this session was mid-edit on `divergences.json`. **All green now** (24 passed).
- **10 are `app/dist` being absent from the recreated worktree**, not a code change —
  and this was **proved, not argued**. The build is gitignored, so `git worktree add`
  produced a tree with no bundle: the SPA catch-all route is not mounted (`the SPA
  catch-all route is gone`) and the flow health reads `bundle_missing` where the test
  expects `cold`. Same cause as chunk 6's `app/dist/fonts absent — build app/ first`
  skip. ⛔ Options Flow is out of bounds for this wave and none of these were touched.
- **1** (`test_ticker_logos::test_run_hires_upgrade_recaches_existing`) did not
  reproduce in isolation — population-sensitive, recorded as such, not chased.

⭐ **THE CONTROL WAS RUN.** `npm run build`, then the same four files:

```
before the build   10 failed,  93 passed     REAL EXIT = 1
after the build     0 failed, 107 passed     REAL EXIT = 0
```

⚠️ **A recreated worktree is not a rebuilt one**, and a lane-to-lane comparison across
the deletion has to say which side had a bundle. Subtracting the 10 build-absence reds,
the 5 mid-edit vendor reds (green as of this commit) and the 1 that will not reproduce,
**run 5's standing position is 39** — which is exactly run 2's **41 minus the 2 that
were fixed**. ⭐ **Old → new: 41 → 39, movers −2, no regression.**

## ⭐⭐ SESSION 2 · PART 3 (HVE half) — AGEN, PREDICTED FROM OUR DATA, CONFIRMED ON THE VENDOR

`tests/fixtures/vendor/uncharted-volume-v2-agen-1d-hve-2026-09-12.json`.

⛔⛔ **THE SYMBOL WAS CHOSEN FROM OUR OWN DATA AND NAMED BEFORE THE CHART WAS
OPENED.** That ordering is the point — a symbol picked by looking at TradingView
would make the comparison circular.

**The scan:** `C:/data/bars.db` read-only, every ticker with ≥2,800 daily bars
(**2,749** of them), evaluating the script's own condition with an O(n)
monotonic-deque sliding max. ⚠️ The script says **`>=`**, not `>` (line 297) —
the scan uses the script's operator, not a paraphrase. **680 symbols** fire in the
last 300 sessions.

**AGEN won on being unambiguous, not on being biggest:** exactly **one** firing in
300 sessions, **17.54×** margin, **6,684** bars so the 2,500 window is full, and a
real event behind it (close 3.35 → 6.12, +83%). SOXS fires 25 times — a leveraged
ETF setting records constantly is a weak discriminator; FER has a bigger margin
but 11 firings and 177 bars ago.

**Predicted → measured:**

| | ours (before) | vendor (after) |
|---|---|---|
| record date | **2026-07-13** | **2026-07-13** ✅ |
| record volume | 174,277,900 | 174,277,926 (rel **1.5e-7**) |
| HVE Trigger on the day | expected 1 | **1** ✅ |

⭐ **This is the first fixture in the project where `HVE Trigger` is not
constant** — 0 on ordinary bars, 1 on the record day.

### ⛔⛔ A REAL DIVERGENCE, RECORDED AND NOT ADJUSTED

**1. Firing count — ours 8, vendor 23 over the whole series.** Cause is
arithmetic, not a bug: the vendor's series starts **2010-07-14** (4,066 bars),
ours **2000-02-08** (6,684). `ta.highest(volD[1], 2500)` over a window that is not
yet full returns the max of what exists, so the vendor's running maximum is lower
through ~2020 and the condition clears more often. **Both lanes compute the
declared formula correctly on the history they hold.**

⚠️ **The implication is worth more than the divergence:** an HVE firing is a
statement about the **loaded window**, not about the symbol's life. On a chart
that has not scrolled back far enough it over-reports. This capture forced 4,066
bars — the study loaded **1,003** on add and **400** after a timeframe change,
both under 2,500 — and a capture taken then would have carried exactly this error.

**2. Volume values — ~1.8% on old bars, ~1e-6 on recent ones. Cause NOT
established.** The vendor reports *fractional* volumes on older bars
(`449522.45`), so some adjustment is applied; the factor is ~0.9814–0.9824 before
2016 and ~1.0000 from 2024. ⛔ It is **not** a split ratio — a reverse split would
be a large integer factor, and the price axis *does* show a price adjustment
(~$56–140 in 2011-13 against a raw ~$3–5). Consolidated-vs-primary tape, or a
provider difference, are both open. **Recorded as undetermined.**

⭐ **The record day is unaffected** — 1.5e-7 — so the case this fixture exists for
stands on both sides.

### Tables, on a second symbol

```
ATR : $0.58 (8.37%)     len 19   no trailing space
| Range: 55.11%         len 15   no
| ATRx: 0.64            len 12   no
Vol : 790.46K (0.16x)   len 22   TRAILING SPACE
```

⭐ The trailing space appears on the Volume cell here too — **confirmed on a
second symbol**, so it is the script's convention and not an artifact of one read.

**Teardown:** study removed, **0 indicators** asserted, editor closed, nothing
saved.

## ⭐⭐ SESSION 2 · PART 3 (v2 half) — THE VENDOR FIXTURE, CAPTURED ON THE 0-INDICATOR RIG

`tests/fixtures/vendor/uncharted-volume-v2-spy-1d-2026-09-12.json`, AMEX:SPY 1D,
last bar **2026-09-11**, captured 2026-09-12T23:10Z.

### ⛔⛔ THE RECEIPT IS AS STRONG AS IT GETS

The editor buffer was hashed before and after the write, and **the after-hash
equals the committed fixture's `file_sha256` exactly**:

```
before  e550e994…c0c6   ← the PRE-R-J revision, left in the editor by an earlier session
after   518a6b22…b28a   ← identical to tests/fixtures/member/uncharted-volume-v2.pine
delta   +13 chars = `, maxval=5000`
```

So the script TradingView ran is **byte-identical to the file in this repo** —
not "the same script", the same bytes. Monaco module id **423129**,
**re-derived** this visit by scanning 10,558 webpack modules for one exporting
`editor.getModels` + `editor.create`, not carried forward.

⭐ **The Add gate caught its own trap**: two spans with own-text `Add to chart`,
one **93×24 visible** and one **93×0** — the zero-height duplicate the rule was
written for. Gate counted 1, `Update on chart` 0 → SAFE TO ADD.

### ⭐⭐ THE VENDOR CONFIRMS RULING D1, IN ITS OWN TYPE SYSTEM

`metaInfo().plots` types the eight outputs itself:

```
plot_0 line   "Volume"            plot_1 colorer → plot_0
plot_2 line   "Avg Vol Columns"   plot_3 colorer → plot_2
plot_4 line   "Avg Vol Line"      plot_5 colorer → plot_4
plot_6 line   "Scale Padding"     plot_7 alertcondition  "HVE Trigger"
```

⛔ **TradingView itself types `plot_7` as `alertcondition`, distinct from the four
`line` plots** — and the four it types as lines are exactly the four
`memberPaneDefinition` draws. D1 was reasoned from Pine's semantics; this is the
vendor agreeing, independently.

### ⛔ THE TABLES WERE READ AS STRINGS, NOT AS PIXELS

**A screenshot cannot recover a trailing space, and one cell has one.** Three
approaches were tried: the study's `tables()` store (`_builtTables`,
`_cellsByTableId`, `_tableSources`) is **empty**; so is
`graphics()._primitivesCollection.dwgtables` — both are staging areas consumed at
materialisation. The strings exist in exactly one place: the draw call.
`CanvasRenderingContext2D.prototype.fillText` was wrapped for **one** redraw and
restored immediately (`restored: true` asserted in the same call).

| table | cell | len | trailing space |
|---|---|---|---|
| Range (Top Left) | `ATR : $6.21 (0.81%)` | 19 | no |
| Range | `\| Range: 137.58%` | 16 | no |
| Range | `\| ATRx: 0.92` | 12 | no |
| Volume (Top Right) | `Vol : 45.51M (1.05x) ` | **21** | **yes** |

⚰️ **THE RANGE TABLE HAS THREE CELLS AND THE EARLIER CAPTURE RECORDED ONE.** On
the 19-study layout the pane was ~20px tall and the chart legend sat on the ATR
cell, so only `Range: 127.58%` came out. That capture is superseded by this one.
The `| ` prefixes are separators the script writes **into** the cell text.

### ⭐ NON-ZERO SPREAD PER READ — the control that this is a measurement

| series | distinct | spread |
|---|---|---|
| Volume | 4 | 32,812,411 → 45,512,741 |
| Avg Vol Line | 4 | 43,318,979 → 45,040,146.1 |
| Scale Padding | 4 | 54,188,427.175 → 56,890,926.25 |
| Avg Vol Columns | 2 | value on the last bar, `null` below it — the two-tone cap only draws above the average |
| HVE Trigger | 1 | ⚠️ **flat 0** — it is the alertcondition, not a series. Recorded as flat, not quietly dropped. |

### Rig left as found

Study removed, **0 indicators asserted** by the corrected probe, editor closed,
pane restored, settings dialog cancelled without applying. **Nothing saved** —
the one authorised save was spent closing Part 0.

⚠️ Chart legend `Indicators → Titles/Values` were turned **off** for the read,
because the Range table renders on the legend's own line. That is a CHART setting,
not a study input, and no captured number depends on it. It is unsaved, so the
**saved** layout still has them on; the live session keeps them off, which
happens to be what the remaining captures want.

### ⏭️ STILL OWED ON PART 3

The **HVE symbol fixture**. `HVE Trigger` is flat 0 on SPY across this window, so
SPY cannot be that case — it needs a symbol on which the condition actually
fires, with the symbol and record date named **before** the capture.

## ✅ SESSION 2 · PART 0 — THE RIG IS AT 0 INDICATORS AND SAVED

**Closed 2026-09-12.** `e3cTXatd` is the scratch rig; the "URL owed" line is
closed with this entry.

| check | result |
|---|---|
| layout title | `SPY … UCT AGENT VISIT 2026-09-10 (disposable)` ✅ the disposable agent layout |
| gate at the write | `visible` · display `[-1446, -54]` · window `[-1287, -272]` → **PASS** |
| indicators before the save | **0** (corrected probe) · no *Remove* item in the context menu |
| the one authorised save | taken, `Ctrl+S`, on this state |
| **after reload** | **0 indicators**, both readings agree |

⛔ **THE RELOAD IS THE PROOF, NOT THE SAVE.** `Ctrl+S` gave no visible
confirmation and the JS probes for a dirty flag found none, so "the save
succeeded" was never asserted from the keypress. What is asserted is what the
server returns: a full reload of `e3cTXatd` comes back with **0 indicators** and
a context menu with **no Remove item**. That is the state Part 0 required, and it
is now persisted.

### ⚠️ THE 19 WERE CLEARED BY SOMEBODY ELSE, AND WHO IS NOT ESTABLISHED

Three hours earlier this chart carried 19 studies and the context menu read
*"Remove 19 indicators"*. On the first read after the window was fixed it carried
**none**. **This session did not remove them** — every removal attempt it made
had failed against the off-desktop window, and its one successful click of that
period landed nowhere.

⛔ **NOT ASSERTED: any link to the 16:12 worktree deletion.** Both are actions by
an unidentified actor on this session's resources on the same afternoon; that is
a **correlation, recorded as one**. It may equally have been the owner clearing a
disposable layout they had just maximised. No cause is claimed for either.

⭐ **AND IT DID NOT CHANGE THE DECISION.** The layout is disposable by title,
nothing on it was worth preserving, and the screenshot at 0 was banked before the
save. The provenance of the clearing is recorded because an unrecorded change of
premise is how a later reader mistakes somebody else's work for a measurement.

### ⛔ THE STUDY-COUNT PROBE WAS OVER-INCLUSIVE, AND IS FIXED

Its first answer was **`studyCount: 2`** on an empty chart — `Splits` and
`Earnings`, the chart **Events** toggles. They carry a `metaInfo().id` exactly as
an indicator does; TradingView offers no *Remove* for them and gives them no
legend row.

⛔ Filter by **`shortId` ∈ {Splits, Earnings, Dividends}**, never by
`packageId` — the built-in **Volume** indicator is also `tv-basicstudies`, so a
package filter would hide a real indicator, which is the error that matters.

⭐ The probe now reports its own control, because *"0 indicators"* and *"the probe
looked nowhere"* are otherwise the same observation:
`studies: 2 · events: [Splits, Earnings] · indicators: 0 ·
controlProbeSawSomething: true`. Cross-checked against the product's own answer
every time. Both are written up in `capture-procedure.md`.

## ⛔⛔ SESSION 2 · TWO STANDING RULES, IN `CLAUDE.md` — 2026-09-12

Both went into the **repo-level `CLAUDE.md`**, the file every session reads,
rather than only into a runbook one project opens. `CLAUDE.md` is editable from
this branch (it already diverges from master here by 21/5 lines), so both land
with the merge.

⏭️ **OWED TO SESSION 3:** the worktree-ownership rule is the **first item** of the
PR body's *member impact / process* section. Written down here because the PR
body is session 3's and this obligation must not travel only in a transcript.

### R8 — a session deletes only what it created

> Never `git worktree remove`, never `git worktree prune`, never delete any
> directory under `uct-worktrees\` the session did not create **in that same
> session**. A cleanup or a prune is a **stop-and-ask**.

⛔ **`.uct-session-owner` at every worktree root**, gitignored, written at
creation, naming the session id and date. **No owner file is NOT permission** —
it means the worktree predates the rule, which is also a stop-and-ask.
`indicator-r0r1` has one now, and it says plainly that this checkout was
**recreated** today rather than created, so the record does not overclaim.

The incident, with what was established and what was **not**, is R8 in
`docs/runbooks/indicator-ecosystem-resume.md`.

### The pipe rule — the pipeline owns the exit code

> Verification of any runner never goes through `| tail`, `| findstr`,
> `| Select-Object`, `| head` or `| grep`. Redirect, read the bare exit code,
> then read the `VERDICT:` line from the log.

⚰️ **THREE TIMES.** Three OOM kills on 2026-09-10; run 4 on 2026-09-12 (one chunk
of twelve, reported exit 0); and the verification command for run 4's own fix,
which reproduced it a third time while the fix was being written.

⭐ **AND IT IS REPRODUCED, NOT ASSERTED.**
`test_a_pipe_MASKS_a_nonzero_exit_code_and_here_is_the_proof` runs a command that
exits **7**, measures **7** bare and **0** through `| tail -1`, and recovers 7 by
redirecting — through the same shell the runners are invoked from. A second case
pins that both rules are in `CLAUDE.md`, because a rule in the wrong file is a
rule the next session skips.

### The fourth CRLF instance, fixed as a CLASS

`tools/lookback_agreement.json` is the **fourth** file of this kind and it landed
unpinned, dirtying the tree on every `npm run test:engine`. The `.gitattributes`
block was three **named files**; naming files caught three and missed the fourth.

⛔ **`tools/**/*.json text eol=lf`** replaces the list.
⚠️ **`tests/fixtures/**` would NOT have caught it** — that rule is scoped to that
tree and this artifact lives in `tools/`. **Checked, not assumed.**
⛔ Restricted to the extension, never `tools/**`: that directory holds PNGs, and
a blanket text rule there is the corrupt-binary hazard the top of the file exists
to prevent.

⭐ It re-normalises nothing. The three previously-unpinned files
(`carried_perf`, `execution_shapes`, `window_perf`) are already stored LF-only
and **have no producer in the repo**, so they cannot churn today — an argument
from today's state, and exactly why the rule is now a class rather than a fifth
line.

## ⚰️⚰️ SESSION 2 · THE WORKTREE WAS EMPTIED MID-RUN — 2026-09-12

**Nothing was lost.** Every commit was pushed before the event;
`origin/feat/indicator-r0r1` and the local branch both read `3f45b1c67`, the tree
was clean at the last status, and the worktree was recreated from that branch
byte-for-byte.

### What was ESTABLISHED

⛔⛔ **AN EXTERNAL PROCESS DELETED THE FILES WHILE A LANE RUN WAS IN FLIGHT.** Not
inferred from timestamps — read out of the run's own logs:

| evidence | reading |
|---|---|
| runner enumerated **1,399 test files** at start | the tree was **intact** when the run began |
| chunk 1: **332 ×** `ModuleNotFoundError: spec not found for the module 'api.services.crypto_box'` | `importlib.reload` of a module whose **source had gone from disk** mid-process |
| chunk 2: `ERROR: file or directory not found: api/services/journal_two/test_telemetry.py` | the file was **gone before pytest could start** |
| `.pytest_cache/v/cache/nodeids` written **16:13:16**, `stepwise` **16:13:23** | something ran pytest in that directory **~45 s after this session's runner was already dead** |

⛔ **THE RUNNER IS EXONERATED, BY READING IT RATHER THAN BY ASSUMING.**
`tools/pytest_chunks.py` performs exactly four filesystem operations —
`out_dir.mkdir`, one `open(log,"w")` per chunk, `log.read_text`, one
`summary.json` write — and contains **no** `shutil`, `rmtree`, `unlink`, `remove`
or `rmdir`. `ROOT` is `__file__.parents[1]`, it never calls `os.chdir`, and it
passes `cwd=ROOT` to each child, so it ran against **this** worktree and no other.
The `journal_two/` paths in its logs are real files of this repo that were being
deleted underneath it, not evidence of a second checkout.

⭐ **AND `--out` IS `--out-dir`** — argparse accepts any unambiguous prefix of a
long option. "The flag I passed does not appear in the source" was a false alarm
that cost forensics time; recorded so the next reader does not chase it.

### What could NOT be determined

- **Which process deleted it.** No actor identified. Six Claude session temp
  directories exist on this box and several sibling worktrees were touched in the
  same minutes (`s7-price-level` 16:13, `flow-watch-rail` 16:14, `notebook-flip`
  16:31, `terminal-research` 16:36) — concurrent multi-session activity is
  ordinary here and none of it is attributable.
- **Whether the git registration was removed by the same actor.** `indicator-r0r1`
  had no entry under `.git/worktrees/` afterwards, which is what a
  `git worktree remove`/`prune` leaves behind and a bare `rm -rf` does not. But
  `.git/worktrees` last changed at **16:36**, ~24 minutes after the deletion, at
  the same moment another worktree was created — so that mtime is not evidence
  about r0r1 either way.
- **The exact deletion start.** The directory's own mtime (16:12:01) is the moment
  `.pytest_cache` was created inside it by chunk 1, which overwrote whatever the
  deletion had set. Bounded only as *after* the file walk and *during* chunk 1.

⛔ **NO GUESS IS RECORDED AS A CAUSE.** The surviving `.pytest_cache` was moved to
the session scratchpad as `forensic-pytest_cache-r0r1` rather than deleted, so
the artifact outlives this session.

### The recreation, verified

```
git worktree add …/indicator-r0r1 feat/indicator-r0r1
HEAD 3f45b1c67 == origin/feat/indicator-r0r1     ✅
git status                                        clean
npm ci                                            (node_modules is gitignored)
npm run test:engine   5,224 passed · 2 failed · 32 skipped
                      the 2 are the routed census floors and nothing else ✅
```

⚠️ **AND THE RUN LEFT THE TREE DIRTY, WHICH IS ITS OWN SMALL FINDING.**
`lookbackAgreement.test.js` rewrites `tools/lookback_agreement.json` on **every**
engine run, LF-only, against a box with `core.autocrlf=true` — content
byte-identical, EOL flag flipped. It is now pinned `text eol=lf` in
`.gitattributes` beside its two siblings (`chart_parity_cases.json`,
`corpus_metric.json`), which is where it should have gone when it was added.

### Run 4 is VOID, and the fix

The cause chain and the four fixes are in
`docs/runbooks/indicator-ecosystem-resume.md`. In short: the deletion (link 1)
made chunk 2 look KILLED, the runner **died printing that warning** on a
`UnicodeEncodeError` for its own ⛔ through a cp1252 stdout (link 3, ten chunks
unrun), and the invocation piped to `tail` so the reader saw exit 0 (link 4) —
which is R7 in that same runbook, broken by the person quoting it.

⛔ Now: the runner makes **its own** stdout UTF-8; every run's **last line is a
VERDICT** and `FAIL` covers no-totals / unparsed counts / a short run / killed /
red; a crashed runner exits **3** and says what did not run; and `--out-dir` is
**refused** if it is a worktree root, inside one, or **above** one — the blast
radius that emptied this worktree was a parent of a checkout.
`tests/test_pytest_chunks_runner.py` carries a case per fix plus the AST sweep
that keeps the exoneration true.

⚠️ **THE VERDICT LINE IS A MITIGATION FOR THE PIPE, NOT A FIX FOR IT.** Measured
again while building it: `--out-dir .` exits **2** bare and **0** through
`| tail -1`. Redirect, read `$?`, and read the last line.

## ⭐⭐ SESSION 2 · R-J — A WINDOW THAT NAMES A MEMBER'S KNOB

**Owner ruling, 2026-09-12, tied explicitly to R-H.** Bound by the **folded
value** for this wave, because the justification is entirely the premise:

```
R-H   a folded `input.int` is an IMMUTABLE parameter baked into the tree
 ⇒    the folded value is the ONLY value that window can take
 ⇒    a lookback bounded by it is a promise the badge can keep
```

⛔⛔ **SO THE PREMISE IS A CONSTANT, NOT AN ASSUMPTION IN FOUR READERS' HEADS.**
`closedTable.json::_input_windows.inputsAreFolded` is declared once and derived
by `parse.js::INPUTS_ARE_FOLDED`, `ast_table.INPUTS_ARE_FOLDED` and
`ast_lint._INPUTS_ARE_FOLDED` (that lane re-derives from its own manifest read —
its stdlib-only rail forbids the import). The gate sits on the **contract
itself**, `bindFoldableWindow` / `bind_foldable_window`, so `lint.js` and the two
lookback readers cannot answer differently about one knob.

⭐ **AND THE REPLACEMENT IS ALREADY ON FILE**, which is the other half of the
ruling. `_input_windows.whenRuntime` = `boundByDeclaredMaxval`: once inputs are
runtime parameters, a window naming one is bounded by that input's **declared
`maxval`**, and an input with **no** `maxval` makes the window unbounded and the
reader **REFUSES**. ⛔ Never fall back to the default — a default is where the
knob starts, and a bound must hold everywhere the knob can reach.

**The rails fire BY NAME the day the constant flips:**
`inputWindowsAgreement.test.js` (7) and `tests/test_input_windows.py` (6). Each
carries the control that makes the constant load-bearing rather than decorative:
pass the flag off explicitly and the same knob goes unanalysable, so the gate
cannot be deleted from the code path while the suite stays green. Both also pin
that the two Python derivations of one declaration agree, and that an
**undeclared** identifier is still unanalysable with the flag either way — R-J
bounds a knob, never any bare name.

⚠️ **IT MOVES NO NUMBER TODAY, AND THAT IS WORTH SAYING.** Metric **31/44 of
266**, install census **25 of 269** — both unchanged. No corpus or member tree
carries a knob-defaulted window in a lookback slot. What R-J buys is that the
four readers agree about the shape when one arrives, and that wave-2 lands on a
rule already written instead of re-deciding it.

### ⭐ The authored edit to v2, alongside

`lookbackBarsHVE` gains `maxval=5000` (line 45, in place — `body_lines` stays
579), so the one member script this wave draws **already carries the bound wave-2
will need**. Without a `maxval`, the day the premise flips this script becomes
unanalysable.

```
body_sha256   93b1959c…28db → 418600be…9115
file_sha256   e550e994…c0c6 → 518a6b22…b28a
__uct_param_3 lookbackBarsHVE  default 2500  min 50  max 5000   ⭐ was max null
```

**Both lanes re-run after the edit, host pasted verbatim:**

```
=== HOST (strict) ===
ok        = true
mode      = host
title     = "Uncharted Volume v2"
outputs   = 5
refusals  = 0
selected  = 0 "Volume"
   0 plot            "Volume"             refusal= null
   1 plot            "Avg Vol Columns"    refusal= null
   2 plot            "Avg Vol Line"       refusal= null
   3 plot            "Scale Padding"      refusal= null
   4 alertcondition  "HVE Trigger"        refusal= null

=== SCREENER ===  ok=true  outputs=5  refusals=4  selected=1
=== IR lane ===   untold  ok=false  runtime:realtime-untold@297
                  told    ok=false  pine:text-value@153
=== PANE ===      document builds, install door admits it, 4 plots drawn
```

Every reading is **identical to before the edit** — which is the point: adding a
declared ceiling to an input changes what wave-2 can promise and changes nothing
this wave computes.

## ⭐⭐ SESSION 2 · T5 — THE PANE, THE FLAG, AND THE COMPARATOR *(code; pixels owed)*

`MemberPane.jsx` composes what already exists — `memberPaneDefinition` builds the
document, the shipped install door validates it, `addInstance` puts it in
`indicatorInstances`, `ChartPane` draws it — and adds nothing of its own except
the flag and the disclosures.

⛔⛔ **FLAG-OFF IS A `null` RETURN BEFORE ANY WORK.** `memberPaneEnabled()` is read
first, inside the component, so on a default build this **installs nothing,
writes nothing and renders nothing**. The rail asserts that against the REGISTRY
LISTING, not against a spy: `PreviewPane`'s header records what a leaked
definition costs — it rides `listUserDefinitions()` onto the member's real chart,
the same list the settings row, the legend and the alert address read. `'0'`,
`'true'`, `''` and `'yes'` are all off; only the exact `'1'` opts in.

| | |
|---|---|
| flag OFF | `container.innerHTML === ''`, no `ChartPane`, **no registry entry** |
| flag ON | one `ChartPane`, `density="mini"`, `showTfBar={false}`, `liveUpdates:false`, `backgroundWarm:false` |
| the blob | the member's own canvas with **every other instance stripped**, `onStore` a noop |
| unmount | uninstalls — asserted against the listing |
| D1's alert note | on screen, verbatim, naming `HVE Trigger` |
| a refusal | the `paneGate` sentence, never a blank |

⚠️ **THE CEILING, STATED AT THE TOP OF THE TEST FILE RATHER THAN IN A REPORT.**
`ChartPane` is mocked, so every case is about **what the pane is handed**. Whether
the four series paint, whether Scale Padding is invisible and scale-setting, and
whether the sub-pane is a quarter high are **screenshot questions** and are owed
against the real chart. Nothing offline may be read as evidence for them.

### ⭐ `seriesCompare.js` — the parity comparator, proved able to fail first

The owner's three terms, each here because the obvious single rule gets one of
them wrong:

- **integers EXACT** — 45,510,000 against 45,510,001 passes any float tolerance
  you would pick and is a different number of shares. Measured in the test: the
  same pair reads **2.2e-8 relative**, which is why the `kind` split exists.
- **floats RELATIVE at 1e-9** — magnitudes here span volume (1e8) and a ratio
  (1e0); an absolute bound is vacuous at one end and unmeetable at the other.
- **the ABSOLUTE error beside it** — 3e-10 relative on a volume column is 0.015
  shares, and a human reading the table needs that number.

⛔ Plus the cases a lenient comparator skips: a blank on ONE side is a mismatch
(warm-up ending a bar early is the defect a parity run exists to catch), a length
mismatch is refused outright rather than graded on the overlap, and a vendor zero
is compared absolutely so one zero bar does not fail a whole series.

⛔⛔ **IT IS EXERCISED BEFORE IT MEETS A VENDOR NUMBER, DELIBERATELY.** The Part 3
capture cannot happen while the rig window is off the desktop, and a comparator
first run against the real numbers later would be an instrument nobody had seen
discriminate — this repo has twice had an instrument manufacture a finding.

### Two rails fired on the new consumer, and both were right

`memberPaneGate.test.js` carried an assertion that the gate had **no importer
yet**, with `placement.js` borrowed as its positive control. `MemberPane.jsx` is
the surface it was written for, so the borrowed control is retired and the real
claim takes its place: the gate has exactly that one importer, **and importing is
not consulting** — the source is checked for `memberPaneEnabled()`, because a
component that pulled the module in and never called it would satisfy an import
scan and still show a member an unfinished pane. `controlDoorCensus.test.js`
required the new `addInstance` caller to be ledgered with its reason.

⚠️ **THREE SUITES ARE LOAD-SENSITIVE, NOT BROKEN.** `manifestProse`,
`enumerationSites` and `EvidenceTab.doors` each walk ~1,400 files and went red in
one full-suite run and green in the next, and all three pass alone. Second full
run: **8,627 passed, exactly the 10 known reds.**

## ⭐⭐ SESSION 2 · R-H — A MEMBER CANNOT VARY AN INPUT PER PANE INSTANCE TODAY

**Owner ruling, 2026-09-12: accepted for this wave, routed for the next.**

⛔ **THE CONSEQUENCE, PLAINLY.** A member's `input.int` that the translator folds
becomes an **immutable parameter baked into the tree**, carried in
`compute.paramManifest` with locators pointing at the literal — *not* a
`defSchema` input an instance holds a value for. `applyParamEdit` rewrites that
literal atomically (every locator's round-trip verifies, or nothing is written)
and hands back a **new definition**.

> **Two panes of one script that differ by a parameter are TWO DEFINITIONS, not
> two instances.**

Measured on `uncharted-volume-v2.pine`, Daily Length 50 vs 10: two ids, two
distinct `compute.trees`, both valid, both installed. The T3 test is titled
`TWO DEFINITIONS with different lookbackBarsHVE — not two instances`, because a
title saying "two instances" would be the artifact that teaches the next
engineer the wrong model.

⏭️ **"INPUTS AS RUNTIME PARAMETERS" IS A NAMED WAVE-2 ITEM**, beside arrays and
loops. It is required for the *user inputs editable* criterion, and that
criterion is **not waived — only sequenced**.

⚠️ **AND `lookbackBarsHVE` SPECIFICALLY CANNOT MOVE A PANE AT ALL**, for a
different reason that is ruling D1's own consequence: `__uct_param_3` appears in
the **HVE Trigger tree and nowhere else**, and D1 sends an `alertcondition` to
Alerts rather than drawing it. Once the pane declines that row the knob has no
drawn series left to move, and `memberPaneVariants` says so by name rather than
installing two identical panes.

---

## ⭐⭐ SESSION 2 · R-G — FOUR READERS OF ONE WINDOW *(page entry; the code landed in `d098fa05d`)*

**24 disagreements → 0** across 1,302 trees (corpus + member fixtures, both
lanes). **`repaints` badges 20 → 0.** **Install census 9 → 25 of 269, no losses**,
16 movers named in the commit. The corpus metric is unmoved at **31/44 of 266** —
correct, because R-G changes what INSTALLS, not what translates.

The rail found **four** instances of one defect class, not one:

| # | shape | who had it right |
|---|---|---|
| 1 | bind-foldable window `isweekly ? lenWeekly : lenDaily` | `lint.js` only |
| 2 | bind-time text `str`/`symtext`/`textop` | `ast_lint.py` only |
| 3 | `lookback: "series"` (`ta.cum`) | `ast_lint.py` only |
| 4 | the recurrence binding `self` | `lint.js` only |

⛔ **A RAIL FIRED AND IT WAS RIGHT.** The first cut imported `ast_table` into
`ast_lint`; `test_no_evaluator_is_reachable_from_the_linter` refused it — that
module may import nothing outside the standard library, so a badge can never be
reached by RUNNING a formula. The linter re-derives the walk from its own
manifest read instead, which is the arrangement the file already documents for
`SESSION_LOOKBACK` and `SERIES_LOOKBACK`: the one authority is
`closedTable.json`, and the agreement rail binds the readers to it.

⚠️ **AN UN-RULED WIDENING WAS PULLED BACK, AND IT IS AN OPEN QUESTION.**
`parse.js::bindFoldableWindow` bounds a knob-defaulted window by its **default**;
`ast_lint`'s docstring refuses to in writing — *"a window that changed with a knob
is a window the badge cannot promise anything about"* — and it is right: the
default promises something the member breaks by raising the knob. The two lanes
have disagreed since **before** R-G, no corpus tree exhibits the shape, and R-G
did not rule it. The readers R-G adds pass `allow_input_default=False`;
`lint.js`'s existing behaviour is untouched. **Owner call.**

⛔ **AND THE CORPUS ALONE PROVES NONE OF IT** — measured before the rail was
written, `corpus/committed` agrees 643/643 both before and after, because it
contains none of the four shapes. The population is corpus + member fixtures, the
shapes are asserted present **by name**, and the comparison is exercised against
synthetic disagreements including the form that actually shipped four times: one
reader answering while the other refuses.

## ⭐⭐ SESSION 2 · R-I — THE PARITY HARNESS WAS MEASURING A CONSTANT

⚰️⚰️ `visualParitySet.test.js::documentOf` decided pane placement with
`t.declaration && t.declaration.overlay`. **`declaration` is the STRING
`"indicator"`** — the word the script declared itself with — so a string has no
`overlay` property, the test read `undefined` for **every script ever written**,
and every document the harness built came out a sub-pane whatever its author
asked for. The real field is `presentation.overlay`.

**Re-measured on the seven members whose source is committed — two moved, both to
the answer their `.pine` declares:**

| member | before | after | `.pine` says |
|---|---|---|---|
| `long_tail__16-spy-position-helper` | own pane | **price(overlay)** | `overlay=true` |
| `mid_engagement__22-rsi-levels-regime-map` | own pane | **price(overlay)** | `overlay = true` |
| the other five | own pane | own pane | `overlay = false` / import refused |

⭐ **NO GRADE MOVED**, because `classify()` never consulted the overlay column —
which is exactly how a constant sat in a published report unnoticed. The decision
is now a named function (`placementFor`) with a control that translates one
`overlay = true` and one `overlay = false` script, and pins that
`declaration` is a string whose `.overlay` is `undefined`, so the next reader who
reaches for it sees why it cannot work.

⛔ **AND THE SET IS NOW MEASURED ON 7 OF 10, LOUDLY.** Three members are
`storage: "local-only"` in `pine_oos/MANIFEST.json` and have never been
committed. The harness used to die on `readFileSync` and report **nothing** about
the other seven; it now grades them `SOURCE_MISSING`, prints the seven, and stays
RED naming the three. Absence is not a pass and it is not a crash either.

⏭️ The full ten-member re-publication is **owed with Part 6**. The
superseded note is published at `C3A_CLOSE_AND_C3B_CENSUS.md` §1, with the
before/after table and the reason gate condition #4 is unaffected (it confirmed
MARKER placement against the vendor's `location` values and says nothing about
which pane a script lands in).

## ⛔⛔ SESSION 2 CLOSE-OUT — THE BROWSER LANE STOPPED, THE CODE LANES SHIPPED

### The stop, first, because it decides three of the seven parts

`document.visibilityState` read **`"hidden"`** on the rig tab before the first write of
Part 0. Under the standing rule — *"if it reads 'hidden' again at any point before an
add, stop immediately rather than clicking"* — the browser lane stopped there.

⭐ **AND THIS TIME THE CAUSE IS NAMEABLE.** Nothing is covering the window: **it is not
on the screen.**

```
document.visibilityState  "hidden"      document.hasFocus()  true
window.screenX / screenY   2308 / -1272    outerHeight  1015
screen.width / height      3440 / 1440     availHeight  1392
```

The window's top edge sits **1,272 px above** the top of the display and its bottom edge
at **y = −257** — the entire frame is off the top of the desktop. Chrome's native window
occlusion tracking therefore reports the tab hidden **while it still holds keyboard
focus**, which is why `hasFocus()` is `true` and the screenshots still render: the
compositor keeps painting for the capture API. Re-read at the end of the session:
identical, byte for byte.

⚰️ **THIS IS A THIRD, DISTINCT FAILURE MODE** beside the 2026-09-11 minimised case and
the 2026-09-12 occluded case. Its signature is the pair `hidden` + `hasFocus() === true`
+ an off-screen `screenY`, and unlike the other two **it cannot be fixed from this side**:
the standing instruction is not to move or resize the window. One click was spent before
the read — TradingView's own context-menu item *"Remove 19 indicators"* — and it did not
take, which is consistent with the window not being hit-testable.

⛔ **NOTHING WAS SAVED TO THE ACCOUNT.** The one permitted layout save never happened,
because the state it was meant to capture (0 studies) was never reached. The rig still
holds its 19 studies and its title is still the disposable agent layout.

### What that blocks, exactly

| part | blocked because |
|---|---|
| **0 — convert e3cTXatd into the scratch rig** | every removal is a click; the save is a write |
| **3 — v2 fixture completion + HVE symbol capture** | reading the pane's cells is a capture |
| **6 — the 20 remaining pine_oos scripts** | all 20 are `storage: "local-only"` in `MANIFEST.json` — every one needs a fresh fetch |
| **5 — T5's flag-on/flag-off screenshots** | a screenshot |

⭐ The 20 owed scripts are **named**, not counted: 5 high_engagement (08, 13, 17, 19, 21),
7 long_tail (01, 10, 14, 15, 18, 19, 20), 8 mid_engagement (01, 03, 04, 05, 08, 10, 15,
23). Their `sha256_source` is already in the manifest, so each capture is verifiable
against a recorded hash rather than trusted.

### T5 was NOT built, and the reason is not the browser

⛔ **THE PANE COULD NOT DRAW THE ONE SCRIPT IT IS FOR.** T3 measured that
`uncharted-volume-v2.pine` is refused by the shipped install door at `resolve:window`
(the bind-time `isweekly` ternary), so a `MemberPane` built today would be a flag-gated
component whose only exercise is a synthetic script, invisible to every human, with a
per-series error table that has no vendor numbers to compare against — *built, tested,
green and unreachable*, which is a shape this repo has paid for repeatedly.

⭐ It unblocks on **one ruling**: whether `interpret.js::ownLookback` (and its Python
mirror) should learn the bind-foldable fold `lint.js::maxLookback` already performs.

### Numbers

| | |
|---|---|
| corpus metric | **31/44 of 266** — unmoved by D1 and D2, correctly: they change which column is OFFERED and which sentence is SHOWN, not what translates |
| chart suite | 417 files · **8,601 passed · 10 failed · 32 skipped** |
| the 10 reds | all measured red at HEAD on a byte-identical restore; 5 are the missing pine_oos corpus, 5 are the known UI doors |
| python lane, run 3 | **23,776 passed · 41 failed · 56 skipped · 10 xfailed**, 12/12 chunks completed, **0 KILLED** |
| python, every test importing `ast_table` | **1,120 passed · 2 skipped · 1 xfailed** (after the change) |
| `npx vite build` | succeeds, 21.8 s |

⚠️ Run 3 was in flight before this session's commits, so its 41 reds are the PRE-change
baseline; the five new `test_alert_condition_note.py` cases are not in it. Red chunks
1, 5, 7, 8, 9, 10, 11, 12 — identical to run 2 through chunk 5, which is what a stable
baseline looks like.

### ⚠️ One byte-cost worth knowing

`_alertconditions` is in `manifestProse.KEEP`, and KEEP is all-or-nothing per top-level
key — so its `_` and `_ruling` prose ship in the bundle, exactly as `_folds`' does. About
1.5 KB. Recorded rather than trimmed: the rulings are the reason the sentence has one
home, and a KEEP that dropped sub-keys would be a second stripping rule to get wrong.

## ⭐⭐ SESSION 2 · T3 — THE MEMBER-PANE PATH, AND THE WALL IT HITS

`app/src/components/chart/builder/memberPane/memberPaneDefinition.js` — the one
function that walks the whole path without a React component in the middle:

```
source → translatePine(strict) → paneGate → rows → buildDefinition
       → installUserDefinitions → addInstance → binder → columns
```

**What lands, measured on `uncharted-volume-v2.pine`:**

| | |
|---|---|
| document | `validateDefinition().ok === true`, 4 data plots + chrome inputs |
| the four rows | Volume · Avg Vol Columns · Avg Vol Line · Scale Padding |
| the fifth output | **not drawn** — `HVE Trigger` is an `alertcondition` (ruling D1) |
| placement | `{target:'pane', pane:{height: 0.25}}` — `defSchema` validates a FRACTION in (0,1) |
| the alert note | emitted on the result, one sentence, the condition named |

### ⚰️⚰️ AND THE SHIPPED INSTALL DOOR REFUSES IT — `resolve:window`

```
compute.trees.out2: refused at registration by "resolve:window" —
sma argument 1 must be a whole number of at least 1, got
{op ?: [series isweekly, num 50, num 50]}
```

That ternary is `timeframe.isweekly ? lenWeekly : lenDaily` — **the exact pattern
`closedTable.json::_bind_time_constants` exists for.** It folds at BIND time, when a
timeframe is known; registration has no binding.

⛔⛔ **TWO AUTHORITIES OVER "HOW FAR BACK DOES THIS TREE REACH", AND THEY DISAGREE.**
`lint.js::maxLookback` HAS the bind-foldable branch (`bindFoldableWindowMax`, taking the
MAX of the arms — over-claiming, the safe direction). `interpret.js::maxLookback` →
`ownLookback` → `windowLiteral` does not, and neither does the Python mirror
`ast_interpret._own_lookback`. `lint.js`'s own comment warns about this split in the
opposite direction: *"the door would defer, the linter would bound, and the member would
get a number nothing produced."*

⚠️ **NOT FIXED HERE — IT IS A RULING.** Teaching `ownLookback` the same fold WIDENS what
a member may install. The direction is provably conservative (over-claim, never
under-claim, which `maxLookback`'s own docstring calls the one direction a budget must
never fail in) and the sibling authority already does it — but which trees a member may
put on a chart is the owner's call, not mine.
`memberPaneDefinition.test.js` pins the DEFECT, so the day it is ruled the case goes red
and names itself.

### ⭐ TWO PANES THAT DIFFER BY A PARAMETER — and why not by `lookbackBarsHVE`

`memberPaneVariants()` produces N definitions differing on one folded parameter.
⛔ **TWO DEFINITIONS, NOT TWO INSTANCES:** a folded `input.int` becomes an IMMUTABLE
parameter baked into the tree with locators pointing at it, not a `defSchema` input an
instance carries a value for. `applyParamEdit` rewrites the literal atomically and hands
back a new definition. Verified on `__uct_param_2` (Daily Length 50 vs 10): two ids, two
trees, both valid documents.

⛔⛔ **`lookbackBarsHVE` CANNOT VARY THIS PANE, AND THAT IS RULING D1'S OWN CONSEQUENCE.**
Measured: `__uct_param_3` appears in the HVE Trigger tree and **nowhere else**. Once the
condition goes to Alerts the knob has no drawn series left to move, and the function says
so by name rather than installing two identical panes.

### ⭐ LWC v5 DOES RESIZE NATIVELY — and the repo already targets pixels through it

`IPaneApi.setStretchFactor`; stretch factors distribute the available height, so a factor
set to a pixel count lands on it exactly (`paneLayout.js`, measured in
`paneSeparatorPin.test.js`). ⛔ But the heights **cannot be read in the tick they were
written** — LWC defers layout to `requestAnimationFrame` — and one deferred frame is not
a settle either, which is why `paneHeightMismatch` is a REPORT and `binder.js` re-applies
and re-arms rather than throwing. A one-pixel drift is a warning; an exception on the
paint path is a blank chart.

### ⭐ THE GATE IS FLIPPED, NOT DELETED

`pineRuntimeFrontendGate.test.js` said *"`pineRuntimeFrontend.js` MAY NOT BE WIRED YET"*
because nothing produced the tri-state. T4 built the producer, so the rule becomes **a
live importer must also reach `pineRuntimeClock`**. ⚠️ That form is VACUOUS while the
count is zero — so the predicate is a pure function proved to fire against synthetic file
lists before it is pointed at the real tree.

⚠️ **AND THE COUNT IS STILL ZERO**, because ruling D2 (option B) drives the pane from the
HOST lane's saved definition, not from the IR lane. That is a decision about which
translation is authoritative, not evidence that the IR lane is safe.

### ⚰️ A MEASUREMENT INSTRUMENT IS READING A FIELD THAT DOES NOT EXIST

`translatePine`'s `declaration` is the STRING `"indicator"`. `visualParitySet.test.js::documentOf`
reads `t.declaration && t.declaration.overlay`, which is `undefined` for **every script
ever written** — so every document it builds gets `target: 'pane'` regardless of what the
author asked for. The real field is `presentation.overlay`.
`memberPaneDefinition.js` reads the right one and the overlay case is the rail. The parity
test is untouched (it is already red on the pine_oos gap) and this is recorded rather than
quietly corrected, because its numbers are a published measurement.

### ⚠️ AND THE REPAINT MODE MUST COME FROM THE LINTER

A hard-coded `'clean'` in the row builder declared `repaints` on a plain
`sma(close, 20)`, and the install door refused it: *"declared \"repaints\" but the linter
MEASURES \"non-repainting\""*. `meta.repaint` is a truth claim a member acts on, and the
door refuses a disagreement **in both directions**. The row builder now asks
`evaluateFormula` — the same function the door asks.

## ⭐⭐ SESSION 2 · D2 (option B) — THE SENTENCE PER LANE, AND THE PANE'S GATE

⚰️ **A REFUSAL PROMISED SOMETHING THE LANE IT FIRED IN CANNOT DELIVER.**
`pine:text-value` reads *"The numeric plots still run; the text output is skipped and
named here"*. In `translatePine` that is exactly true. In `buildRuntimeIr` one text
statement takes the whole program — and the reassuring half is the one a member reads.

**What the IR lane owes, measured and unchanged by this commit:**

| script | lane | verdict |
|---|---|---|
| `uncharted-volume-v2.pine` | host (`strict`) | `ok=true`, 5 outputs, **0 refusals** |
| `uncharted-volume-v2.pine` | IR, told `forming=false` | `ok=false` · `pine:text-value@153` |
| `uncharted-volume.pine` | IR, told `forming=false` | `ok=false` · `pine:text-value@151` |

⭐ **OPTION B LEAVES THE BEHAVIOUR ALONE** — the text layer is session 3's, and
changing a lane that is about to be reworked is how a fix gets done twice. What
changes is the wording, through `pineRuntimeFrontend.js::RUNTIME_LANE_REFUSALS`:

> this script uses a text feature our chart does not render yet. This lane stops at
> the first one, so none of this script runs here — the screener and host lanes
> still translate its numeric plots

⛔ **AN OVERRIDE, NOT A REWRITE OF THE SHARED TABLE.** Editing `pine.js` would make
the sentence wrong in the lane where it is currently right. The guard, line and
column are untouched. `pine.js::PER_ROW_PROMISE_GUARDS` names the guards whose
sentence makes a claim about the OTHER rows, and the rail derives the coverage
requirement from it — a second such guard added without an override fails **by name**
rather than reaching a member with a false promise. ⛔ Declared, never sniffed out of
the prose: a phrase match over member-facing copy breaks the day somebody rewords a
refusal, and breaks silently.

### ⛔⛔ `paneGate.js` — a pane draws the HOST lane's verdict or it draws nothing

T3/T5 read the saved definition the host lane produces, and that decision now has ONE
home instead of four call-site `if`s.

⛔ **THE SCREENER LANE IS INADMISSIBLE BY CONSTRUCTION, AND THAT IS THE WHOLE
RULING.** On Volume v2 the lenient lane answers **`ok: true` with FOUR refusals** —
correct for a screen, which needs one usable column. A pane built on that verdict
draws one line and silently omits the rest of the member's script.

⛔ **AND `ok` ALONE IS NOT ENOUGH SINCE D1**: an alert-only script translates cleanly
and answers `selected: -1`. The gate reads lane, `ok`, `selected`, and the selected
row itself — and returns a REASON, never a bare `false`, because a pane that declines
owes the member a sentence.

## ⭐⭐ SESSION 2 · D1 (option C) — A PANE DOES NOT SELECT AN ALERT

⛔⛔ **THE TWO LANES DISAGREED ABOUT WHAT AN `alertcondition` IS, AND THE HOST LANE
HAD THE WRONG ANSWER.** `chooseOutput` PREFERRED it over every plot — *"an
alertcondition IS a condition by construction, so it wins"* — while `buildRuntimeIr`
classified it as PRESENTATION and emitted no series for it. So the output a pane
selected was exactly the one the runtime lane has nothing to draw.

**Measured on the real member script, before → after:**

| | |
|---|---|
| `uncharted-volume-v2.pine` host `selected` | **4** ("HVE Trigger") → **0** ("Volume") |
| the same script, screener `selected` | **1** → **1**, unmoved |
| the alertcondition row itself | still index 4, still `refusal: null` — a SPLIT, not a deletion |

⭐ **THE SCREEN IS UNCHANGED AND THAT IS THE POINT.** A scan asks *"when is this
true"*, and a condition is the right first offer there. Only the lane that has to put
a line on a chart changed, and `pine.alertLane.test.js` carries the control that
would fail an engine which had simply stopped preferring conditions anywhere.

**The sentence has ONE home**, exactly as ruling 1.1 required of the fold note:
`closedTable.json::_alertconditions.memberNote`, read by `parse.js::alertNotesOf` and
`api/services/ast_table.py::alert_notes`, interpolated by the PRODUCER (never the
component), rendered verbatim by `PineBox` beside the vendor and fold notes:

> This script's alert condition 'HVE Trigger' is available under Alerts; it is not
> drawn on the chart.

⛔ Keyed off `kind`, never off `selected` — a script declaring three conditions has
three things to tell the member, and the second and third are not the selected row by
construction. `_alertconditions` is registered in `manifestProse.KEEP`: stripping it
changes no number and moves no selection, so every test would stay green and the
member would simply never be told — the `_folds` failure shape, one ruling later.

⚠️ **A script whose ONLY output is a condition now answers `selected: -1` on a pane**,
with `ok: true` (nothing failed to translate). That is the honest answer — there is no
line to draw — and it is written down rather than left to be discovered. The pane's
gate is `selected >= 0`, not `ok`.

⏭️ **Routing the condition into `alertSets.js` is a FOLLOW-UP**, not part of this
ruling. Today the sentence tells the member where the condition lives; nothing
subscribes it yet.

## ⭐⭐ SESSION 2 · T4 — THE `newestBarIsForming` PRODUCER, AND THE 3.3 REFUSAL LIFTS

`app/src/components/chart/engine/ast/pineRuntimeClock.js` + 11 assertions in its test.

⛔ **IT COMPUTES NOTHING, AND THAT IS THE WHOLE DESIGN.** No calendar, no `Date.now()`,
no timeframe arithmetic. The tri-state is settled once per fetch by
`indicator_compute.py::bar_close_state` — the side the NYSE calendar lives on — and
`/api/bars` already attaches it as `newest_bar_is_forming`. `computeClock` says it in its
own words: *"the seam carries the tri-state; the calendar does not cross it."* This module
is the runtime lane's copy of the wire the native lane already had
(`barCloseStateWire.test.js`), written as a function so there is one place to test.

```
newestBarIsFormingFrom(payload)   → true | false | null   (undefined ⇒ null, never false)
runtimeClockOpts(forming, extra)  → { newestBarIsForming, interpretOpts: {…} }
formingByBar(bars, forming)       → per-bar, only the newest can be true
```

⛔⛔ **THE TEST NOBODY ASKED FOR IS THE IMPORTANT ONE.** `buildRuntimeIr` lifts the 3.3
refusal on EITHER `opts.newestBarIsForming` or `opts.interpretOpts.newestBarIsForming`,
but the columns are evaluated from `interpretOpts` alone — so a hand-written caller can
pass the gate and still render four blank columns, which is ruling 3.3's own failure
arriving through the door the ruling installed. `runtimeClockOpts` fills both from one
value, and the shape is pinned.

**The three the owner asked for, measured:**

| | |
|---|---|
| closed daily series | `false` on every bar, the newest included |
| newest bar is the current session, before close | `true` on **exactly** that bar |
| the refusal | present only while UNKNOWN — `false` is an ANSWER and lifts it |

⭐ And the per-bar answer is asserted **against `computeClock`'s own `isrealtime`**, not
against a literal: the producer must never become a second authority over what the four
realtime columns hold. Plus a control that a script with no realtime column never needed
the producer at all.

### `buildRuntimeIr` on Volume v2, verbatim

```
uncharted-volume-v2.pine  [untold]              ok=false  runtime:realtime-untold@297
uncharted-volume-v2.pine  [told forming=false]  ok=false  pine:text-value@153
uncharted-volume-v2.pine  [told forming=true]   ok=false  pine:text-value@153
uncharted-volume.pine     [untold]              ok=false  runtime:realtime-untold@296
uncharted-volume.pine     [told forming=false]  ok=false  pine:text-value@151
uncharted-volume.pine     [told forming=true]   ok=false  pine:text-value@151
```

⭐ **THE NEW REFUSAL IS NOT NEW — IT WAS NAMED IN ADVANCE.** Session 1 recorded that the
IR lane's blocker *"lifts the moment T4's producer lands — at which point
`pine:text-value@151` becomes the next named blocker again"*. v2 line 153 is
`f_getTablePos(_pos) => _pos == 'Top Left' ? position.top_left : …`, a string compared in
a value slot, and the wording is R3.4's, ruled 2026-09-11. Checked against the rulings on
file before writing it down: nothing here is unruled.

### ⚠️ AND IT PUTS A DECISION IN FRONT OF T3/T5 — see the decision-ready items below

The IR lane refuses **the whole script** at `pine:text-value`, while the refusal's own
sentence says *"The numeric plots still run; the text output is skipped and named."* Both
cannot be true of one lane, and Volume v2 is the script T5 is meant to draw.


## ⛔ TWO DECISIONS T3/T5 CANNOT BE STARTED WITHOUT — decision-ready, 2026-09-12

### D1 — what a pane does with an `alertcondition`, and whether Volume's HVE reaches a member

**Measured, today, both lanes:**

| | |
|---|---|
| `translatePine` | `alertcondition` is a **first-class output row** with a real tree, and `chooseOutput` **prefers it over every plot** — *"an alertcondition IS a condition by construction, so it wins"*. That is why v2's `selected` is **4**, the HVE Trigger. |
| a saved definition | has **no notion of one**. It becomes the definition's value column like any other 0/1 tree; `defSchema.js` never hears the word. |
| `buildRuntimeIr` | classifies it as **PRESENTATION** (beside `fill`, `bgcolor`, `hline`) and emits **no series** for it. |
| the renderer | `binder.js` / `markerPrimitive.js` know `plotshape`/`plotchar` glyphs and nothing about alert conditions. `alertSets.js` is UCT's own alert machinery, not a consumer of imported Pine. |

**So the answer to the question as put: none of the three.** It is not plotted as markers,
not held for an alerts consumer, and not ignored either — in the screener door it is the
DEFAULT offer as an ordinary boolean column, and in the runtime lane it is dropped as
presentation. The two lanes disagree about what kind of thing it is.

⛔ **And that lands on v2 specifically**: the output the host lane SELECTS (index 4, HVE
Trigger) is exactly the one the runtime lane emits nothing for. T5's *"the four selected
plots draw"* is indices 0–3; index 4 is the alertcondition.

**Options.**
- **A — a pane draws it as event markers on firing bars.** The member sees HVE where the
  script fires. Costs: a `markers` plot needs a glyph, a placement (the bar's high? the
  pane's top?) and a colour nobody declared — the script says none of it, because Pine
  draws nothing for an alertcondition either. ⚠️ This invents a rendering, which is what
  you told me not to do.
- **B — a pane draws it as a 0/1 line, like any other boolean column.** Honest, no
  invention, consistent with what the saved document already is. It looks like a square
  wave at the bottom of the pane and a member may reasonably ask why.
- **C ⭐ — the pane does not draw it; it is offered to the ALERTS door instead, and the
  runtime lane's PRESENTATION classification becomes the single answer.** `chooseOutput`
  then stops preferring it for a HOST target (it may keep preferring it for a screen,
  where a condition is exactly what is wanted). Volume's HVE reaches a member as an
  alert, not as a line — which is what `alertcondition` means in Pine.
- **D — leave it exactly as it is** and let the pane show whatever `selected` points at.
  For v2 today that draws a 0/1 column titled "HVE Trigger" beside four volume series on
  one scale, which is the least defensible of the four.

**My recommendation: C**, with the `chooseOutput` split made explicit (screen prefers a
condition, pane prefers a plot). It needs no new rendering, it makes the two lanes agree,
and it is the reading of Pine's own semantics. ⛔ It is a ruling, not an implementation
detail, because it changes which column a member's import lands on.

### D2 — the IR lane refuses a whole script for a text statement, and its own sentence says otherwise

`buildRuntimeIr(v2, told)` → `pine:text-value@153`, **ok=false for the entire script**,
while that refusal's message reads *"The numeric plots still run; the text output is
skipped and named."* In `translatePine` that sentence is true — the text helper is not an
output there and v2 answers **ok=true, 5 outputs, 0 refusals**. In the runtime lane it is
false: one text statement takes the program.

**Options.**
- **A — the IR lane skips a text-only statement and keeps the numeric outputs**, matching
  the message. Unblocks T3/T5 on v2 today. Cost: it is a behaviour change in the lane
  session 3 is going to rework anyway, and a skipped statement must be reported, not
  silent.
- **B ⭐ — T3/T5 drive the pane from the saved definition the HOST lane already produces**
  (5 outputs, 0 refusals) and the IR lane stays as it is until session 3's text layer.
  Nothing changes in a lane that is about to be reworked, and the pane has everything it
  needs today.
- **C — wait for session 3.** T3/T5 do not start.

**My recommendation: B.** It is the only one that starts T3/T5 without touching a lane
whose text layer is already scheduled, and the message/behaviour mismatch in A is exactly
the kind of thing to fix once, in session 3, with the text layer in front of it.

⚠️ Either way the mismatch itself is a defect on file now: a refusal that says the other
outputs still run, in a lane where they do not.

## ⭐ VOLUME v2 CAPTURED, AND THE OOS CORPUS IS 40/60 — WITH THE 20 NAMED

### The v2 vendor capture — `tests/fixtures/vendor/uncharted-volume-v2-spy-1d-2026-09-12.json`

19 studies before · 20 after · 19 after removal · nothing saved. **8 plot channels** in
`_metaInfo.plots` order over the last 300 of 630 daily bars, AMEX:SPY:

```
0 Volume            27,422,263 … 165,293,521      na 0   zero 0   ⭐ the live control
1 (colorer)         4,282,726,130 … 4,287,003,512
2 Avg Vol Columns   43,318,979 … 92,174,150.66    na 187 — plots only above the average, by design
3 (colorer)         4,287,003,512 (constant)
4 Avg Vol Line      43,318,979 … 92,174,150.66    na 0
5 (colorer)         436,207,615 (constant)
6 Scale Padding     54,188,427.175 … 206,616,901.25
7 HVE Trigger       0 on all 300
```

⚠️ **`HVE Trigger` is 0 throughout and that is not a fault** — SPY has not set a
2,500-session volume record in the window. It does mean **the HVE path is unread on the
vendor side**; a capture that exercises it needs a symbol with a recent volume record or
a smaller window, and the fixture says so rather than implying coverage.

⭐ **THE SOURCE WAS FETCHED, NOT PASTED.** `fetch()` in the page against the committed
file's raw GitHub URL, sha256 checked before `setValue` and again on read-back. That
retires the paste wall for anything already committed, and keeps the same receipt a
paste would have needed.

⚠️ **Tables: one captured, one partial.** `Vol : 45.51M (1.05x)` in full;
`Range: 127.58%` from the ATR table with cells 2–4 clipped — on a 20-study layout each
pane is about twenty pixels tall and the legend overlays the table. Reading the rest
means enlarging the pane, which is a saved-layout change I did not make unasked. The
route is written in the fixture.

### pine_oos — 30 held-locally scripts, 10 restored, 20 still to fetch

**40 of 60 now present, every one hash-verified against `sha256_source`, zero
mismatches, and `git status` shows nothing from `tests/fixtures/pine_oos`** — the
licence-driven ignore holds.

| | |
|---|---|
| already present | 30 |
| **restored this session** | **10** — copied from `tools/c0_oos_fixtures`, each one's sha256 checked against the manifest before it was written |
| still missing | 20 (named below) |
| hash mismatches | **0** |

⛔ **TWO BULK ROUTES WERE TRIED AND BOTH FAIL — recorded so nobody spends them again:**

1. **Fetch the script page.** `https://www.tradingview.com/script/<id>/` returns 634 KB
   of HTML with **no source in it** — no `//@version`, no `"source"` key. TradingView
   renders the code client-side.
2. **Fetch pine-facade directly.** `pine-facade/get/PUB;<shortId>/last` answers
   `404 Script is not found`: the short URL id is not the facade's script id, and the
   mapping only exists in the page's client state.

⭐ **So the remaining route is per-script and manual-ish**: open each URL in its own tab,
let the page resolve the script, read the source through the editor, hash it. Twenty
scripts, and it is the honest cost — no bulk shortcut exists.

**The 20, by name:** `high_engagement__08-market-structure-break-ob-probability-toolkit-luxalgo`
· `…13-ultimate-opening-range-breakout-luxalgo` · `…17-volume-profile-and-volume-indicator-dgt-dgtrd`
· `…19-anchored-vwap-stuehmer` · `…21-parabolic-sar-deviation-bigbeluga` ·
`long_tail__01-ny-macro-status` · `…10-mtf-supply-demand` · `…14-vwap-z-score-oscillator`
· `…15-agreed-upon-dol` · `…18-deltalabs-equal-highs-equal-lows` · `…19-session-fibs-falcon-ai`
· `…20-cot-pulse-cloud-trend` · `mid_engagement__01-zeiierman-trend-pressure` ·
`…03-volatility-supply-demand-zones` · `…04-cisd-order-block` · `…05-supertrend-fibonacci-ote`
· `…08-hourly-alpha-profile-terminal` · `…10-smc-engine` · `…15-multi-timeframe-ma-forecast`
· `…23-distilled-htf-po3`.

⛔ **Floors stay at 60.** Nothing was substituted and no floor was lowered to match what
is on disk — the census reds are the honest report that the corpus is 40/60.

### And restoring the corpus exposed two more ruling-1.2 consequences

`documentSize.measure` and `graphSize.measure` both build a document for
`…03-supertrend`, which now carries no column at all, and both failed as *"the document
should build"* — which reads like a deleted fixture rather than a ruling. Each now
asserts the truth by name: **that script builds NO document**, with the two-step history
(R-F took nine columns, 1.2 took the tenth) written at the line.

### Suite, end of session

```
app/src/components/chart/   413 files   405 passed   8 failed
```

| red | why |
|---|---|
| `historyDemandCensus`, `capabilityDemandCensus` | 139 vs >150 — the 20 missing scripts |
| `objectDemandCensus`, `visualDemandCensus` | 40 vs 60 — the same |
| `visualParitySet` | one ENOENT, `mid_engagement__05-supertrend-fibonacci-ote` |
| `pineBoxSuggestVoice` ×3, `ImportBox.thinkscript` | `import-suggest` never renders — a UI door, unrelated to the engine, red before this session |
| `BuilderSheet.pine` | the save-door `sent.id` case, likewise pre-existing |

**Five of the eight are one cause**, and it is the 20 scripts above — not a defect.

## ⭐⭐ T1 + T1b — `ta.tr(true)` READ FROM THE VENDOR, AND VOLUME'S LINE 189 IS CLEAR

**The capture ran end to end, autonomously, and nothing was saved to the account.**
19 studies before · 20 after each add · 19 at the end · both scratch studies removed by
the legend's own control · chart left on AMEX:SPY 1D as found.

### The reading

```
verdict   ta.tr(true) IS the guarded three-term max —
          na(close[1]) ? high - low : max(high - low, max(abs(high - close[1]), abs(low - close[1])))

away from bar 0   SPY 1D, 2,244 bars across two readings:
                  diff_vs_candA = diff_vs_candB = diff_vs_sibling = 0.0 on EVERY bar (exact zeros)
                  SPREAD_control 0.59 … 55.57, zero count 0, na count 0   ⭐ the capture is live

at bar 0          NASDAQ:CRWV 1D (listed 2025-03-28, 366 bars — the whole history fits the window)
                  is_first_bar 1 · subject_tr_true 4.48 · subject_is_na 0 · subject_eq_highlow 1
                  candA 4.48, diff_vs_candA 0 · sibling_is_na 1 · candB, diff_vs_candB, diff_vs_sibling all na
bar 1             all four agree again — which is why only bar 0 can settle it
```

Fixture: `tests/fixtures/vendor/r11-tr-true-spy-1d-2026-09-12.json`, probe sha256
`df8945b2…d941`, 4,604 bytes, receipt verified in-page against the committed file before
either add.

### ⚰️ The probe could not answer its own question, and the probe was the defect

First attempt: 1,829 output rows and `is_first_bar` **0 on every one**. `max_bars_back =
500` is spent as warm-up, so TradingView begins output past it — and on the `All` range
(405 monthly bars) the study produced **nothing at all**, the same fact stated louder.
The probe needs exactly one bar of history (`close[1]`); the declaration was buying
nothing and costing the answer. Removed, with the measurement written at the line.

⭐ **And bar 0 is not reachable on SPY at any range** — the study's output window never
starts at `bar_index == 0`, because TradingView computes from further back than it
returns. The instrument is the SYMBOL: a recent listing whose whole history fits inside
the window. Same move `r11-nvi` made to read SPY's 1993 seed on a monthly chart.

### T1b — the pin, and what it cleared

`BUILTIN_SERIES_TREE.trGuarded` is declared, `ta.tr(true)` translates, and the two forms
stay DIFFERENT columns (collapsing them would answer not-computable where the member's
chart shows a number, on the first bar of every symbol's history). The guard is
`na(close[1])`, not `bar_index == 0`: what is missing is the offset, so a hole anywhere
else in `close` gets Pine's answer rather than a different one.

A non-literal flag still refuses — with a corrected sentence, because the old one said
`ta.tr(true)` "asks for a bar where no true range is defined … this engine leaves that
bar not-computable rather than inventing it". That was right while the vendor's answer
was unread. It is not an invention now that it is measured.

**Corpus case:** four committed scripts write `ta.tr(`, all of them the `true` form —
`atr-god-strategy-by-tradesmart__4369755a29` (3 sites),
`kernel-channel-backquant__d8c4b7f75c`, `renko-candles-overlay__d76a18d49e`,
`smart-money-breakouts-chartprime__ea79c79a67` (2 sites). None of the four flips to
translating: each is held by something else (`pine:block`, `pine:function`,
`pine:declaration-strategy`…), which is why the metric does not move.

**Volume v1, both lanes, after T1b — line 189 CLEAR:**

```
SCREENER (default)   ok=true   outputs=5  refusals=4   pine:function@225   (ta.cum, by ruling)
HOST/pane (strict)   ok=false  outputs=5  refusals=1   pine:state@284      (R-A3: refuse with offer)
```

### Re-frozen, with the reason at each site

| artifact | old → new |
|---|---|
| `pine.namespacedExpansion` | the `ta.tr(true)` case flips from refusal to the guarded tree, asserted DERIVED (else-branch must equal the bare form) so the three-term max cannot drift between them |
| `pine.blindCorpusDecomposition` | `volatility-range-contraction-base` loses its last blocker — all three fell to captures rather than arguments; miss floor **21 → 20** |
| `tools/corpus_metric.json` | host 31/266 · screener 44/266 — **unmoved by T1b**, and that is the honest result |

### Rules added to `capture-procedure.md`

- **The pre-write gate, three readings, immediately before `setValue` AND before the Add
  click** — visibility, own-text gate, study count — run in the SAME evaluation as the
  write so nothing can move between them.
- The gate needs **`height > 0`**: TradingView renders the label twice, once as a
  zero-height measuring copy, so a width-only test finds two and reports FALSE.
- ⚰️ **`placement=dialog` is NOT "undocked" on this build** — correcting this morning's
  rule. The in-tab right panel is `dialog` and it is where the TEXT button lives; the
  bottom dock has no toolbar and puts the action in the tab's ⋯ menu. The real
  discriminator is "can this session read the editor's DOM in this tab, and is there a
  visible, enabled own-text Add to chart".
- Create new → Indicator lives on the right panel's chevron only; the submenu **did**
  populate under a synthetic hover (the 2026-09-11 note was measuring the coordinate bug).
- Bar 0 needs a short-history symbol; `max_bars_back` is spent as warm-up; the `All`
  range button changes the RESOLUTION (1D → 1M).

## ⛔ PHASE 1 STOPPED — THE WINDOW IS OCCLUDED, AND NOTHING IN THE PAGE CAN CLEAR IT

Autonomous browser run, 2026-09-12. **Nothing was written: no `setValue`, no click on any
Add/Update control, 19 studies before and 19 after.**

The MCP tab group from the earlier attempt no longer existed (`No tab group exists for
this session`), so a fresh tab was opened on the same layout — `e3cTXatd`, AMEX:SPY, 1D —
and it came up clean: **19 studies, no editor loaded at all, no bound buffer**, which is
a better starting state than the detached editor holding `UCTPROBE_R11_TIME_TF`.

Then the precondition failed:

```
visibilityState  "hidden"        ⛔ the gate
document.hidden  true
hasFocus()       true            ← after a synthetic click; focus proves nothing here
innerWidth/H     1920 x 855      ← healthy
screen           1920 x 1080     ← healthy
studies          19, fully painted in the screenshot
Monaco           not instantiated · gate elements: none · `pine-dialog-button` present
```

⚰️ **THIS IS NOT THE MINIMISED FAILURE THIS PROGRAMME ALREADY KNOWS.** On 2026-09-11 a
minimised window read every dimension as zero, `screen.width` included. Here every
dimension is right and the chart paints; the window is simply **covered by another
application**, and Chrome's occlusion tracking marks a fully covered window hidden. The
published pre-flight (`{vis, w, h}`) cannot tell the two apart.

⛔ **Three attempts, none of which moved it** — recorded so the next session does not
spend them again:

| attempt | result |
|---|---|
| synthetic click into the page | `hasFocus()` flipped to true, `visibilityState` unchanged |
| `resize_window` 1680×950 | reported success; `innerWidth` still 1920, visibility unchanged |
| create a second tab in the same window | the chart tab became a background tab as well |

Occlusion is an OS-level fact about which window is on top. Nothing inside the page
changes it, and an ADD on a hidden tab is the one thing the runbook forbids outright:
`insertStudy` reports success and inserts nothing.

⭐ **The durable fix is a rig setting, now written into `capture-procedure.md`:**
`chrome://flags/#calculate-window-occlusion` → **Disabled** (or launch Chrome with
`--disable-backgrounding-occluded-windows`). Then the capture window keeps reporting
`visible` while the operator works in another application. Failing that, the window needs
to be genuinely unobscured — a second monitor, or a terminal that does not cover it.
**Partial visibility is enough; focus is not required.**

⚠️ **The tab is left open and ready** (`e3cTXatd`, 19 studies, no editor loaded). The
moment that window is unobscured, Phases 1–4 run without re-navigating.

Also recorded in `capture-procedure.md` this pass: the corrected binding gate (own text
only, tooltips excluded, visible + enabled, and `placement=dialog` = undocked = stop) and
the Phase 1 docking ladder.

## ⭐ PART 1 RULINGS — BOTH LANDED (2026-09-12)

### 1.1 — the fold disclosure reaches a member · `df0310fb8`

`baseTimeframeFolds` was emitted on every folded output row and **no surface read it**;
by the roster's own words that is *merely KNOWN*. Now: the sentence is declared once in
`closedTable.json::_folds` and `PineBox` renders it verbatim in `pine-vendor-notes`,
composing nothing. One declaration, two readers (`parse.js::foldNotesOf`,
`api/services/ast_table.py::fold_notes`), one renderer.

> This script's daily `request.security` was folded to the chart's own daily series —
> identical on a closed daily chart; would differ by one bar intraday.

⛔ It cannot come from the tree — a fold ERASES the call, so `vendorNotesForTree` can
never find it. `_folds` is registered in `manifestProse.KEEP`, and the keep-list rail
caught it as *"kept but never read"* before the reader existed, which is the rail
working. Rails from the shared schema (`fold_requires_member_note`): an accepted fold row
owes the note; a non-vacuity control that an accepted fold row exists; and the sentence is
asserted at the member's door against `FOLD_NOTES` rather than a copy, with a control that
an unfolded script gets no note.

### 1.2 — a helper the author hid is not a column · this commit

`high_engagement__03-supertrend-kivancozbilgic` refused on all nine visible columns, kept
the author's untitled `ohlc4` fill edge, and the door **selected** it. Ruled a
mistranslation wearing a label. New guard, wording as ruled:

```
pine:hidden-only — the only outputs that translate are helper series the author hid;
                   nothing this script displays can be screened
```

**Branch A** — every survivor is author-hidden ⇒ refuse, name the visible plots'
refusals, and ADD that line (never instead of them). Scoped to the AUTHOR's own reasons:
a `constant` or `passthrough` survivor keeps `pine:constant-only` /
`pine:presentation-only`, which are the more precise sentences.
**Branch B** — a helper beside a real column is shown, not offered, and wears **its own
variable name plus a `hidden` tag**, never the script title (`pine-hidden-label-*`,
`pine-hidden-tag-*`).

⭐ **THE PREDICATE TOOK A MEASUREMENT TO GET RIGHT, AND THE FIRST VERSION WAS WRONG.**
"Untitled AND filled" cost `rvol__05fcd9e160.pine` its only column — `pvol = plot(rv)`
with `fill(pvol, pth, …)`, where `rv` is `volume / sma(volume, 21)`: the indicator itself,
merely unnamed. The published predicate adds the third test that separates the two:

```
hidden as `fill-anchor`  ⇔  no title  AND  handle consumed by fill()  AND
                             the plotted argument is a BARE PRICE SOURCE NAME
                             (open|high|low|close|volume|hl2|hlc3|ohlc4|hlcc4)
```

It reads the argument's SPELLING, not the folded tree, because `ohlc4` folds to
arithmetic a member might have written deliberately. ⚠️ It under-refuses on purpose:
`src = ohlc4` then `plot(src)` is not caught — a column wrongly offered is visible to the
member and to this corpus; one wrongly refused is invisible.

### Metric, re-derived — old → new, movers named

```
after R-F (db9ea2f2e)   host 31/266   screener 46/266
after ruling 1.2        host 31/266   screener 44/266     measured_at 2026-09-12
```

| mover | what it was offering |
|---|---|
| `supertrend-explorer__V4MsmtCeKs.pine` | `ohlc4` under a Supertrend title — the ruling's own case, a second time |
| `market-structure-trend-targets-chartprime__d3c06abad6.pine` | `hl2` under a market-structure title |

Ten further corpus scripts gained the sentence beside refusals they already had; their
verdicts did not move. Host is unchanged: both movers were screener-lane passes.

### Re-frozen for 1.2, with the reason at each site

| artifact | change |
|---|---|
| `pine.corpus` guard coverage | 10 → 11 guards; `pine:hidden-only` joins, from `10-supertrend` |
| `paramSingleTranslation` | the R-F specimen rail now expects both sentences |
| `builderInputs.symbolClosure` | the "single column, and it is SCAFFOLDING" case answered by ruling: **zero** carried, `selected: -1`, the row still shown as `mPlot`/`fill-anchor` |
| `graphSaveDoor` | that script produces **no document at all** now; the case records both steps down (438KB → 1KB → nothing) so neither reads as an achievement |
| `graphWireFixture` | the `supertrend` band is replaced by `…24-coppock-curve-multi-filter` (the Python lane asserts five bands; a quietly-four fixture would read as a passing measurement) and the emitter now fails BY NAME on a case that carries nothing |
| `graphRuntime` | roster loses that script, gains `…24-coppock`; the expand-cost case moves to `…22-rsi-levels`; a new rail asserts the removed script carries no trees, so the day it translates again this goes red |
| `corpusMetric` | explicit 180s timeout — it crossed vitest's 15s default once under full-suite load and reported "timed out" beside a console line carrying the numbers |

**Chart suite: 402/413 files green.** The 11 reds are the routed pre-existing set
(`pine_oos/*.pine` absent → 5 files + 4 census floors; three UI-door files unrelated to
the engine).

## ⛔⛔ R-F — THE SHIPPED DEFECT IS FIXED, AND IT COST FIVE PUBLISHED SCRIPTS ON PURPOSE

**Ruling R-F (owner, 2026-09-12): fix, not route.** `forgetsItsSeed` admits `+` only; a
bare monotone `max`/`min` refuses with the same offer sentence R-A2 authored. Done, with
every artifact it touches re-frozen and a reason at each line.

### What was removed, and the sentence that replaced it

```js
// REMOVED from forgetsItsSeed (pine.js ~2809)
if (n.type === 'call' && (n.name === 'min' || n.name === 'max')) {
  const withSelf = args.filter(carries)
  return withSelf.length === 1 && ok(withSelf[0], true)   // ok(self) === true
}
```

⛔ **`ok()` returns true for bare `self`**, so `max(self, y)` was declared
seed-forgetting. A running max never forgets its seed — the seed stands until something
exceeds it — and `accum` re-seeds `PINE_STATE_WARMUP` = 250 bars back, so the column
answered *"the highest of the last 250 bars"* to a member who wrote *"the highest ever"*,
`ok: true`, no disclosure, no window shown.

⚠️ **A DECAYING extreme (`m := max(m * 0.9, close)`) is refused too.** That one really
does forget, so this is a named over-refusal in the safe direction; narrowing it is one
line (swap `ok` for a `contracts` predicate in a restored arm) and is **not** done on
spec, because no corpus script writes it.

### Metric, re-derived — old → new, with the movers by name

```
before R-F   host 33/266   screener 47/266
after  R-F   host 31/266   screener 46/266      measured_at 2026-09-12
```

| mover | what it is |
|---|---|
| `atr-trailing-stop-by-ceyhun__UMldb6tGLd.pine` | trailing stop |
| `supertrend-explorer__V4MsmtCeKs.pine` | Supertrend band |
| `10-supertrend.pine` | Supertrend band |
| `05-chandelier-exit.pine` | trailing stop |
| `04-ut-bot-alerts.pine` | trailing stop |

⭐ **Every one is a trailing stop or a Supertrend band — which is the evidence that the
admit arm was not catching an edge case, it was catching the use case.** They are
**correct losses**, said plainly in every freeze: a count that falls because a wrong
answer stopped being produced got *more* true, not less.

⚰️ **And `measured_at` in `tools/corpus_metric.json` was a hand-typed `'2026-09-11'`** —
it went stale the first time the metric moved. It is derived from the run now.

### The two pinned tests, flipped — and one of them had been RIGHT in August

- `pine.variables.test.js` — *"a running maximum, which is the shape a trailing stop is
  built from"* asserted `accum(close, max(self, close), 250)` **as correct**. ⛔ The
  defect was codified in a test whose title named the use case.
- Its companion on `10-supertrend.pine`: the **2026-08-11** version asserted
  `ok === false` with `pine:state`, *"a trailing stop being state by construction"* — and
  it was **right**. An 08-12 "correction" replaced it with *"IT TRANSLATES"*, because the
  fold had started admitting the shape. Both flipped; both histories kept in place rather
  than rewritten, because a test that swung to a wrong answer and back is worth more as a
  record than as a clean assertion.
- Controls kept, as ruled: `+` still folds to `accum` **with its window** (a contracting
  recurrence), and an explicit-window call still translates untouched
  (`pine.accumulatorOffer.test.js`, 10 tests).
- ⭐ **The structural guard was REHOUSED, not deleted.** "Two accumulators in one column
  each keep their OWN `self`" lived on `10-supertrend.pine`, which now refuses; it is
  asserted on a written contracting pair instead, with a control that the two bodies must
  DIFFER (a flattened accumulator reused in both branches would still split to two
  `accum(`).

### Re-frozen, with the reason at every site

| artifact | old → new |
|---|---|
| `pine.corpus` translating | 15 → 14 |
| `pine.corpus` columns | 55 → **46** (exactly the 9 `10-supertrend` was offering) |
| `doorScorecard` OPEN | 8 → 10 (42 → 41 at three sites; scannable 17 → 14) |
| `constructCoverage` persistent-state | 14 → 11 |
| `pine.paramCorpusCount` | 15 → 14 · 31 → 29 · 1208 → 536 |
| `pine.community` | 19 → 17, plus two new guard rows |
| `__fixtures__/pineCorpus.json` | regenerated (`PINE_CORPUS_WRITE=1`) |
| `compat_harness/…/05-chandelier-exit.json` | translate SUPPORTED → UNSUPPORTED at `pine:state` |
| `graph_wire` fixture (supertrend row) | 438,263 B / 10 plots / graph → **1,102 B / 1 plot / not a graph** |
| `tools/corpus_metric.json` | 33/47 → 31/46 |

### ⚠️ The timeout suite was measuring a REFUSED script, and that is worth more than the fix

`pine.timeout.test.js` used `10-supertrend.pine` as *"a perfectly normal script"*. Under
R-F it refuses, so its resolution work is truncated: the script that used to reach 500
resolution steps now stops at 389, and two caps went red. ⛔ **A refused script is a bad
vehicle for a budget test** — it measures less machinery than the cap ships against, and
it gets quieter every time a guard gets stricter. The vehicle moved to
`13-average-true-range.pine` (still clean), with the numbers **measured, not guessed**:

```
total resolution steps, whole script ....... 4,378
largest SINGLE resolution .................... 314     => every cap <= 300 fires, 500 is clean
```

⭐ And the file now asserts its own PREMISE — that the vehicle translates clean, by name —
so the next ruling that refuses this script fails with a sentence instead of silently
measuring a truncated run. (The old per-resolver comment claimed *"~6,500 steps overall,
largest single resolution under 1,000"* for Supertrend; measured today it is 12,895 and
389. The claim was stale in both halves.)

### Builder lane: three specimens moved, each move stated at the line

`high_engagement__03-supertrend-kivancozbilgic` keeps **one** of its ten columns.

⚠️⚠️ **AND THE ONE THAT SURVIVES IS THE AUTHOR'S `ohlc4` FILL EDGE — so the door SELECTS
it.** An import of that script now offers a column called Supertrend that is the average
of the bar, with the nine refusals named beside it. The door's policy ("offer what
translates, name what does not") is working as written; whether a scaffolding column may
be the *selected* one is a product question I have not settled — it is asserted as a fact
in `builderInputs.symbolClosure.test.js` so it is visible rather than discovered.

| file | was | now |
|---|---|---|
| `paramSingleTranslation.test.js` | supertrend in `COMPLEX` (4 scripts) | 3 scripts + a `REFUSED_BY_RF` rail asserting the refusal by guard; locator-spread case → `…14-master-line-lite` (1 input, 7 trees, 95 locators); declared-disjointness case → `…22-rsi-levels-regime-map` (10 declared) |
| `builderInputs.symbolClosure.test.js` | `Multiplier` mutation controls | `GateInp` (`…13-spma-trend`) **+ a WRITTEN witness under the original `Multiplier` name** |
| `graphSaveDoor.test.js` | two DOCUMENT_SIZE_BLOCKED scripts | one, plus a recorded case that the other is now 1,041 B and the graph form declines it ("not a multi-tree document") |

⛔ **The coverage R-F actually cost, named:** the uppercase-initial member-input class had
TWO corpus witnesses and now has one. A class held up by a single fixture is one ruling
away from being held up by none — hence the written witness, where no future ruling can
take it away.

### ⚰️ FOUND WHILE ROUTING: ruling 3.5 landed with two RED tests nobody flipped

`BuilderSheet.pine.test.jsx` pasted `request.security(syminfo.tickerid, "D", close)` in
two cases and expected `pine:request`. Ruling 3.5 (the base-period identity) makes that
call the identity on a daily base, so it **folds to bare `close`**, Use enables, the
formula box fills. Both tests sat red across **four commits** because this file was not
run. Fixed: the refusal cases move to `"60"` (still refuses), and the fold gets a case of
its own at the door a member actually uses. ⛔ **The lesson is the timing: a ruling that
turns a refusal into a fold owes its red tests the same re-freeze as a corpus number, in
the commit that lands it.**

### ⚠️ AND THE ACCEPTED DIVERGENCE ROW'S MEMBER HOOK DOES NOT REACH A MEMBER YET — RULING NEEDED

`divergences.json::request-security-base-period-identity-vs-lookahead-off-step-back` is
`accepted` with `member_hook: {kind: 'fold', name: 'baseTimeframeFolds'}`. The engine
really does emit it (per output row, `pine.js:9870`) — **and no surface reads it**:

```
grep -rn "baseTimeframeFolds" app/src --exclude-dir=engine/ast   =>  (nothing)
```

Per the schema's own words, *"`accepted` means the member is TOLD — a row nobody is told
about is merely KNOWN"*. The channel exists and the renderer does not. ⭐ There is an
exact precedent to copy: `pine-vendor-notes`, which renders *"maths we RAN and ran
differently"* for the active output and deliberately sits apart from the "lines a screen
does not read" list. **What I need from you:** whether to render the fold there, and
whether the sentence is composed in the component (against the file's stated discipline
that it writes no sentence of its own) or declared once in `closedTable.json`. I did not
invent member copy for this.

### The roster and both rails: the THIRD two-lane split, caught by the other lane again

New row `running-extreme-folded-to-a-250-bar-window`, status **`corrected`** — not
`accepted`: after the fix we produce no number at all, so an accepted row would owe a
member a sentence about a difference that no longer exists. It carries the before/after,
the five movers, and what would reopen it.

⚠️⚠️ **And the Python rail failed it while the JS rail passed it.** `test_vendor_truth.py`
has always required `decision.what_changed` and `correctedIn` on a corrected row;
`vendorTruth.test.js` did not know either field existed. That is the **third** instance of
the exact split `divergences.schema.json` was created to end (after `decision`-as-a-string
and `why_keep_ours`). Both are declared in the shared schema now,
`decision_required_keys_when_corrected` + `corrected_requires_correctedIn`, and **both
lanes read them from it** — the Python lane's hardcoded list is gone. JS 1 file green,
Python 24 passed.

`closedTable.json::_no_offset_reopened_by` gains the R-F addendum: the narrowing went the
*other* way and the clause governs it too — nothing the linter decides changed, and the
ruling moves scripts OUT of the translating set, never in.

`docs/superpowers/plans/2026-08-11-plain-recurrence-implementation.md` — the OBV
incident's home — gains the one line R-F asked for, citing this as the **second instance
of the class**, with the five movers.

### ⭐ R-A3, recorded as a ruling

The refuse-with-offer fallback **stands** as the answer to R-A/R-A2. The R-A2 measurement
(our window vs TradingView's all-time max) is **moot and will not be run**: with ours
refusing there is no number of ours to put beside it. Written into the divergence row's
`probe.under_tradingview` as *not captured, by ruling*, so nobody later reads the blank as
an omission.

### Suite state — every remaining red was red before R-F, and that is MEASURED

```
app/src/components/chart/   412 files   11 failed / 401 passed     25 -> 22 failing tests
```

⛔ **I did not take this on faith.** I swapped `HEAD`'s `pine.js` in, ran the same 15
files, and put the R-F file back byte-identical (`cmp` clean). Every one of the 11 was
already red at `fc6fa2037`; the three that R-F broke — `paramSingleTranslation`,
`builderInputs.symbolClosure`, `graphSaveDoor` — are fixed, and `pine.corpus` went from 4
failures to green. Then I swapped in the pre-**today** `pine.js` to be sure none of
today's committed rulings caused the rest: the same 11 fail there too, except the two
3.5 cases above, which are now fixed.

**Routed, not ours (11 files, 22 tests) — and it is ONE cause for five of them:**

| class | files | what it is |
|---|---|---|
| `tests/fixtures/pine_oos/*.pine` **absent** | `documentSize.measure`, `graphSize.measure`, `objectLadder` (×2), `visualParitySet` | the directory holds only the `.json` results; the `.pine` sources are not in this worktree, so the read ENOENTs |
| the same gap as a COUNT | `objectDemandCensus`, `visualDemandCensus` (30 vs 60), `capabilityDemandCensus`, `historyDemandCensus` (129 vs >150) | half the frozen 60 is unreadable, so every census floor misses by about half |
| UI doors, unrelated to the engine | `pineBoxSuggestVoice` (×3), `ImportBox.thinkscript`, `BuilderSheet.pine` (the save-door `sent.id`) | `import-suggest` / `pine-output-refusal-1` never render; fails identically on pre-today `pine.js` |

⭐ **The census floors and the missing corpus are one fact, not two**, which is worth
saying because four separate red tests read like four problems. The `pine_oos` `.pine`
sources are the thing to land — and that is the same corpus the 30-row `pine_oos` table on
the remainder list is about.

## 🧾 SESSION 1 — WHERE VOLUME STANDS, VERBATIM, AND THE RE-RUN DRY-RUN

```
VOLUME [screener] ok=true  outputs=5 refusals=4   4 x pine:function@225  (ta.cum, by ruling)
VOLUME [host]     ok=false outputs=5 refusals=1   pine:state@284
VOLUME buildRuntimeIr      ok=false               runtime:realtime-untold@296
```

⭐ **The IR lane's blocker MOVED, and to a better refusal.** It was
`pine:text-value@151`; ruling 3.3 now fires first at **line 296**, where Volume writes
`barstate.isconfirmed`. That is the refusal-instead-of-blank the ruling asked for, and
it lifts the moment T4's producer lands — at which point `pine:text-value@151` becomes
the next named blocker again.

**The blocker chain, whole:**
`pine:reassign@250` → `@260` → `pine:request@259` → `pine:state@284`. Three cleared by
work; the fourth is **R-A, paused** — see above.

### R-E — the dry-run, re-measured twice as master moved

```
measured 2026-09-11   against 36596a88a   549 behind / 314 ahead   4 conflicts
measured 2026-09-12   against a5173fe41   (master moved mid-session)
re-measured           against b272db249   583 behind / 329 ahead   4 conflicts

.gitattributes                                  append-vs-append, keep both
.gitignore                                      append-vs-append, keep both
api/services/ticker_explain.py                  fixed on both sides
app/src/components/screener/reachable.test.js   union the acknowledgement list, then run it
```

⭐ **Master moved TWICE during the session and the conflict set did not change** — same
four files, same shapes. So the 45-90 min estimate holds, and the re-measure was worth
taking rather than quoting the old SHA.

## ⛔ T1 — THE RIG ANSWERED, THE BINDING GATE FIRED, AND THE UNBIND IS THE BLOCKER

**Nothing was written to the owner's account.** 19 studies before and 19 after; no script
saved, no study added or updated; `__uct*` globals empty throughout.

### What worked, in the runbook's order

```
list_connected_browsers   1 browser, local          ✅
visibilityState/hasFocus  visible: true, focused: true   ✅ (the hidden-tab hazard is clear)
layout                    e3cTXatd "UCT AGENT VISIT 2026-09-10 (disposable)"
symbol                    AMEX:SPY
resolution BEFORE         "5"        ⚠️ see below
setResolution('1D')       asserted after the call: "1D"    ✅ (step 2 of the J2 discipline)
data, polled from outside 405 bars, status type 2          ✅ (step 3)
studies                   19, all the prior UCTPROBE_* present
```

⚰️ **AND IT SETTLES A QUESTION THE LAST VISIT LEFT OPEN.** `capture-procedure.md` records
that the interrupted `setResolution('5')` of 2026-09-11 *"did NOT persist"* and that the
chart was found on `1D`. **It was on `5`.** So the interrupted set DID persist, and the
✅ in that section is wrong. The section's own reasoning still stands — the two outcomes
are indistinguishable without reading, which is why it was right to record rather than
assume — but the recorded ANSWER needs correcting.

### 🔴 The blocker: the editor is BOUND, and the unbind route will not drive

```
"Add to chart"     0
"Update on chart"  1        ⛔ the gate fired, exactly as designed
editor title       "Untitled script"
```

Per S5 every add binds the editor, **including to an unsaved "Untitled script"** — so
this is the safer of the two binding cases (no NAMED saved script is at risk), but a
`setValue` + click would have **UPDATED one of the 19 studies already on the chart**
instead of adding a new one. The gate refused before the buffer was touched, which is the
ordering that matters.

The documented unbind — script-title dropdown → hover *Create new* → *Indicator* — got as
far as the dropdown. The menu opens and is correct (Save script · Make a copy · Rename ·
Version history · Move script to bottom · **Create new ▸** · recents · Open script). The
submenu **does not render under a synthetic hover**, across two attempts with the pointer
confirmed on the row.

### ⭐⭐ AND THE REASON THE FIRST TWO ATTEMPTS MISSED IS WORTH MORE THAN THE ATTEMPT

**`getBoundingClientRect()` and the `computer` tool's click frame are different coordinate
spaces on this page.** Measured: the DOM put *"Create new"* at `(1146, 291)`; it is
visibly at `(850, 238)` in the 1568×698 click frame. Same element, ~26% apart on x. So a
click computed from the DOM lands in empty space and returns "Clicked at …" **exactly as
if it had worked** — a silent miss with a success message, which is the worst shape a
browser step can have.

⛔ **So: locate by screenshot, not by `getBoundingClientRect`, whenever the click goes
through `computer`.** The DOM is still right for READING state; it is the CLICK frame that
disagrees. Two of tonight's three failed interactions were this, not the menu.

### What T1 needs next

Not more poking. Either a real pointer (the owner drives the two-click unbind and hands
back a chart whose button reads *"Add to chart"*), or a route that does not need the
submenu. Everything else is prepared and proven: probe committed, runbook written, S1-S5
route understood, the accessors corrected (`status()`, not `isFailed()` — that method is
not on the wrapper at all, which my own runbook had wrong until `capture-procedure.md`
corrected it).

⚠️ **The chart is left on `1D`**, not restored to `5`: that is where T1 wants it and where
the visit before last left it. Said here so it is a recorded choice rather than a
surprise.

---

## ⛔⛔ R-A2 — THE STOP CONDITION FIRED, AND THE FALLBACK SHIPPED

R-A2 authorised a host-lane fold **and set a stop condition**: build it only if
`maxLookback` stays a plan-time constant and the repaint verdict stays decidable before
the tree runs. **It does not.** The measurement, taken on this engine's own
already-shipped unbounded accumulator rather than on a hypothetical:

```
cum(volume)             maxLookback = 0      repaint = repaints
                                             "unanalysable: `cum` declares a window
                                              this linter cannot bound"
cumFrom(volume, 0, 250) maxLookback = THREW resolve:window   (needs literal args)
accum(0, volume, 250)   maxLookback = 250    repaint = non-repainting, back 250
highest(volume, 250)    maxLookback = 250    repaint = non-repainting, back 250
highest(volume, 5000)   maxLookback = 5000   repaint = non-repainting, back 5000
```

⭐⭐ **An unbounded form is undecidable in BOTH dimensions TODAY, and the engine already
ships one.** `cum` is host-served under `window_dependent`, and it answers
`maxLookback = 0` — the one direction `maxLookback`'s own comment says a budget must
never fail in, *"because a lookback silently guessed at 0 … hands back numbers computed
from bars that were never fetched"* — while the repaint linter puts it in the `repaints`
tier, whose definition is *"the forward reach is UNKNOWN or UNBOUNDED … an unanalysable
shape"*.

⛔ So R-A2's premise — *"in the host lane there is no unbounded evaluation: the fetch
window is the data"* — is true of the RUNTIME and false of the PLAN. The fetch depth is
not a translate-time quantity: one definition is evaluated against any number of bars,
so "anchored at the window start" has no constant to put in the node. A **stated**
window is decidable; the only decidable fold is therefore one that picks the member's
window for them, which is exactly the trade the `cum` ruling refuses.

⭐ **`highestFrom`/`lowestFrom` do not exist either** — `cumFrom` does, `highest`/`lowest`
do, and declaring two new BAR names owes a corpus case and re-freezes every frozen
per-AST digest (the gate that reverted `ceil`/`floor` within the hour).

### What shipped instead: the pre-authorised hand-back

The refusal stands and now **names the bounded call**, with the window left where it
belongs. Following `cum`'s own precedent, the guidance rides in the MESSAGE and not in
`suggest`, because the member must choose the window and `suggest` means *"the exact text
that works"* everywhere else in this door.

```
var float s = 0.0 / s := s + volume
  → pine:state … ". THIS ENGINE DOES DECLARE A BOUNDED FORM: `cumFrom(<that value>,
     <anchor>, <bars>)` — the same running total with the starting instant STATED.
     Stating the window is what makes the answer the same tomorrow — an all-time value
     moves with however many bars were fetched."

uncharted-volume.pine:284  → the same, naming `highest(<that value>, <bars>)`
```

7 tests in `pine.accumulatorOffer.test.js`, including **two creep controls**: a
non-monotone `x := x * y` refuses with NO offer, and `max(self, self)` gets none either.

⚠️ **Two assumptions of mine cost a cycle each and are written at the line:** `cOp` puts
the operator on `name`, not `op`; and there is **no `ternary` node type at all**
(`NODE_TYPES` has eleven and that is not one), so an `if`-wrapped reassignment hides the
fold one level below whatever a conditional canonicalises to. A shape match missed
Volume — the one script this ruling is about. It is a WALK now, indifferent to both.

### ⚠️⚠️ AND THE RULING UNCOVERED A SHIPPED DEFECT — ROUTED, NOT CHANGED

**A bare monotone `max`/`min` accumulator does not refuse. It folds, to a 250-bar rolling
window.** Measured:

```
var float m = na / m := math.max(m, volume)
  → accum(0 / 0, barindex > 0 ? max(self, volume) : self, 250)      ok = true
```

A member who wrote *"the highest ever"* gets *"the highest of the last 250 bars"*.
`forgetsItsSeed` admits `min`/`max` against a self-free operand because they *"forget
once that operand dominates"* — true about the SEED and silent about the WINDOW, since
`accum` re-seeds `PINE_STATE_WARMUP` bars back.

⛔ **This is the defect the convergence gate was built for.** Its own comment cites *"a
250-bar ROLLING SUM presented as OBV, on every bar, drawing a line nobody would
question"*. The gate caught `+` and admitted `max`/`min`.

⚠️ **NOT changed here.** Refusing it is member-visible on every shipped definition using
the shape, so it is the owner's call. Two tests PIN the current behaviour so the decision
is made deliberately rather than discovered later.

### Screener lane, containment, and the governance clause

- **Screener (R-A2 step 3):** unchanged and already correct — `pine:state` refuses in
  both lanes, and the offer now rides the same sentence, so the screener answer is the
  hand-back the ruling asked for.
- **Containment (step 4):** nothing was admitted, so no definition can carry this to a
  comparability-sensitive consumer. `window_dependent`'s existing containment is
  untouched and unrelied-upon.
- **Step 6, the reserved clause:** checked FIRST, as a gate. Both roles are identified by
  TASK — *"spec §4 / the repaint-linter task"* — in `closedTable.json` and repeated
  verbatim in `docs/runbooks/ast-conformance-gate.md:428`; neither names a role held by
  anyone else, so nothing tripped. The addendum is recorded in
  `closedTable.json::_no_offset_reopened_by` with the measurement and the plain statement
  that **this ruling does not re-open unbounded evaluation** — what shipped changes
  nothing the linter decides.
- **Step 7, the measurement:** the SPY 1D our-window-vs-TradingView comparison is **moot
  under this outcome** — there is no number of ours to compare, because nothing folds.

### Metric, re-derived after R-A2

```
before R-A2   host 33/266   screener 47/266
after  R-A2   host 33/266   screener 47/266     (unchanged — a message gained a sentence)
```


## 📌 3.2 — DEFERRED, NOT BLOCKING: the command is on disk for the owner

The prod read was **denied to this session** by the auto-mode classifier
(`[Production Reads]`). Local box: **4 rows, 0 mentioning `barssince`** — a dev store,
which says nothing about production.

- the copyable command: **`tools/CHECK-barssince-arity-in-user-definitions.md`**
- the read-only probe: **`tools/_probe_barssince_arity.py`** (`mode=ro`, never writes;
  `py_compile` clean; verified against the local store)

`TWO_ARG_HITS 0` → 3.2 lands. Any hits → listed by owner and **refused rather than
silently broken**, per the ruling.


---

## ⛔⛔ R-A — PAUSED: `ta.cum` AND VOLUME:284 ARE **NOT** THE SAME CLASS, AND THE CODE SAYS SO

R-A rules that the `ta.cum` ruling "extends to it verbatim, as a CLASS". ⛔ **It does
not, and implementing it as written would end an architectural invariant.** Read before
touching anything, which is why nothing was touched.

### The two are different in the one way that matters

| | `ta.cum` | `priorMaxAllTimeDaily` (Volume 284/292) |
|---|---|---|
| has a window? | **yes** — `cumFrom(source, anchor, window)` is declared and translates today | **no** — `math.max(self, volD[1])` from bar zero, no anchor, no bound |
| what is wrong with it | the value moves with FETCH DEPTH — window-**dependent** | there is no window to depend on |
| cost of admitting | a disclosure: tag the definition `window_dependent`, refuse it for a screen | **static decidability itself** |

`REFUSALS['pine:state']` states the cost in its own words:

> *"an unbounded accumulator would end static decidability — `maxLookback` could no
> longer be a tree sum and the repaint verdict could no longer be decided before the
> tree runs — so it is not a backlog item."*

So the `window_dependent` mechanism cannot carry this one: that tag exists to say *"this
number moves with the request"*, and it presumes a number the linter can still reason
about statically. An unbounded accumulator removes the reasoning, not the certainty.

### And the decision is explicitly reserved — to two owners, together

`closedTable.json::_no_offset_reopened_by`, verbatim:

> *"Re-opening this is a SPEC decision, not an implementation one: it belongs to the
> owner of the repaint claim (spec section 4, the phase's repaint-linter task) plus the
> owner of this manifest, together, because it changes what the linter can decide and
> what both lane walkers must implement. **It is not a v2 feature request that any later
> task may grant on its own.**"*

⛔ A single-session ruling, even the owner's, is the thing that clause names and
excludes. So R-A is paused rather than applied, and **T2 cannot complete tonight**.

### ⭐ THE THIRD OPTION, WHICH NEEDS NO DECIDABILITY CHANGE

The `cum` door already solves this shape the member-facing way: it **refuses and hands
back the call that works**, leaving the anchor with the member, visible in their own
script. The same move is available here:

```
member writes   priorMaxAllTimeDaily := math.max(priorMaxAllTimeDaily, volD[1])
door hands back ta.highest(volD[1], <a window the member states>)
```

Volume **already writes exactly that on the next line** — line 294 is
`priorMax1YDaily = ta.highest(volD[1], lookbackDays)`. So the script's own author
reached for the bounded form one line later, and the HV1 trigger is built on it. ⭐ The
offer is therefore not a guess about what a member meant: it is the shape that script
uses for its other threshold.

**What that costs a member, honestly:** their HVE trigger becomes "highest in N" rather
than "highest ever", and they choose N. That is a different feature, and the door would
say so — exactly as the `cum` sentence says `cumFrom` is not `cum`.

### Three ways forward, for the record

- **A** — grant the static-decidability change, the two named owners together. Largest,
  and it reaches past Pine into `maxLookback` and the repaint linter.
- **B** — keep refusing on both lanes. Volume's HVE is then not expressible, and the
  script refuses with a sentence naming line 284. Status quo, honest, no work.
- **C** ⭐ — **the door offer**: refuse, and hand back `ta.highest(volD[1], n)` with the
  window stated, exactly as `cum` hands back `cumFrom`. No decidability change, and it
  is the idiom this engine already ships. My recommendation.

### What was measured, and what could not be

✅ Ours: `pine:state@284`, both lanes, reproduced after every change tonight.
⛔ The SPY 1D comparison R-A asks for (our 5,000-bar window vs TradingView's full
history, both values with dates) **was not taken: no browser**. It is also moot under
B and C — there is no number of ours to compare until A is granted.


---

# ▶️ TOMORROW — THE PLAN, IN ORDER, WITH HONEST MINUTES

⛔⛔ **T0 IS NEW AND IT COMES FIRST, BECAUSE THE SUITE IS RED.** Ruling 3.5 is built,
measured and WIP-committed at `29d64a2ef`, and twelve tests in nine files still assert
the behaviour it changed. Nothing else should land on top of a red engine suite — a
second behaviour change would make attribution impossible.

| # | item | minutes | needs |
|---|---|---:|---|
| **T0** | **Land ruling 3.5.** Six mechanical updates with the ruling cited (`pine.test.js` ×4, `pine.timeframe`, `pine.requestOffer`) — **30**. Six that need judgment: `interpret.tfDaily.test.js` (the 2026-09-01 ruling's own test), `doorScorecard` ×2 and `pine.blindCorpus` (staleness rails firing correctly — their rosters/rulings need re-deciding), `pine.community` + `.guards` (the named roster moved 18 → 19) — **60-90**. Then both lanes + rails green. | **90-120** | — |
| **T1** | **`ta.tr(true)` reading.** Prep is done: probe `docs/pine/probes/r11-tr-true.pine` (12 plots), runbook `T1-RUNBOOK-tr-true.md` (go/no-go, binding gate, Monaco handle, receipt, study gate, poll-from-outside, roster, what the reading decides), fixture name reserved. | **20** | ⛔ **browser** |
| **T1b** | **Item 5 — pin it**, or record-and-do-not-pin if no corpus case exercises the argument (4 committed scripts write `ta.tr(`). Declaring a BAR name owes a corpus case and re-freezes a cross-lane oracle. | **45** | T1 |
| **T2** | **Volume: `translatePine` strict + `buildRuntimeIr` both ok.** Two blockers left, and **one of them is a ruling, not a gap**: `pine:state@284` is `priorMaxAllTimeDaily`, a running ALL-TIME maximum, which is exactly what `ta.cum` refuses ("names no anchor"). `pine:text-value@151` is a bind-time string compare in a UDF — the same class as the Kind-4 fold, ~60 min. | **120-180** | ⚠️ **owner ruling on unbounded accumulators** |
| **T3** | **The IR→pixels list, in order.** Zero-importer gate lifted; `pineRuntimeFrontend.js` wired from a saved definition. ⛔ When the gate goes red, build and **delete the gate in the same commit** — it is not a test to edit. | **90** | T2 |
| **T4** | **`newestBarIsForming` producer in the JS lane**, which lifts the 3.3 refusal. The producer EXISTS for the served lane (`521a52816`, `9dfe101e0`); what is missing is this lane's path to it, through `/api/bars` → `binder.js` → `nativeRegistry.computeFor` → `interpret`. | **90** | T3 |
| **T5** | **The pane.** Volume on SPY 1D behind `VITE_PINE_MEMBER_PANE_ENABLED`, sub-pane below price, 4 numeric plots drawn, two-instance no-bleed test, and the flag-off rail becomes non-vacuous (its 5th claim stops being empty the moment the renderer gains an importer). | **120** | T4 |
| **T6** | **R2 text layer + `table.*`** → both tables rendered and anchored; cell-by-cell string compare vs TradingView, 300 bars, spread control, `ta.cum` notice visible in the screenshot. | **180** | T5 |
| **T7** | **Mobile**: `tools/mobile_audit.py` at **390×844** and **1024×768**, viewport pinned, 4 screenshots, pass/UNTESTED per row. ⚠️ Do not point it at port 8077 without re-pinning — that port has held a stale backend on live `C:\data`. | **60** | T6 |
| **T8** | **Merge `origin/master`.** Dry-run measured: **4 conflicts** against `36596a88a` (two are append-vs-append). Merge 45-90, then re-verification 60: both full lanes + rails, Python killed-chunk count back at zero, JS byte-identical claim **re-derived not carried forward**. PR body drafted. ⛔ No `gh pr create` without the word. | **105-150** | T0 |

**Total: 920-1,065 min ≈ 15-18 hours.**

## 🔻 WHERE THE CUT IS, NOW

```
SESSION 1   T0 + T1 + T1b + T2      275-365 min   (4.5-6 h)   ← T1-T6 do NOT fit one session
SESSION 2   T3 + T4 + T5            300 min       (5 h)
SESSION 3   T6 + T7 + T8            345-390 min   (6-6.5 h)
```

⛔ **T1 through T6 is three sessions, not one.** The single biggest reason is T0, which
did not exist when the T-list was written: landing 3.5 costs 1.5-2 hours because six of
its twelve red artifacts are rulings and rosters rather than assertions.

⚠️ **And T2 is gated on a ruling, not on work.** An all-time-high accumulator has no
bounded equivalent; folding one means choosing an anchor on the member's behalf, which
is the exact trade `ta.cum` refuses. Volume cannot reach `ok: true` until that is
decided — so if the ruling comes late, T2 slips and T3-T5 slip with it.

## Two items that are NOT in the T-list and are now owed

- **`pine_oos`'s 30 local-only scripts could not be re-fetched**, and the blocker is not
  the network. `source_url` is a TradingView **script page** (fetched fine: HTTP 200,
  395 KB) and `capture_method` is **null**, while `sha256_source` is the hash of the
  **Pine text**. Reproducing the original capture needs the Pine-editor/facade route —
  the same browser path T1 needs. ⛔ I did not scrape-and-guess: an extractor differing
  by one byte would report "sha mismatch" for 30 scripts and the defect would be mine.
  **Floors stay at 60.** Nothing was committed from that directory (it is ignored —
  `git status` confirms clean).
- **`switchBinding` throws past `translatePine`** on one committed script. Comment
  corrected tonight (`cfaa48014`); the fix itself is routed as a corpus item.

---

**Written 2026-09-09 before a machine restart, so this wave can be picked up cold.**
Delete or rewrite it when the wave closes; it describes work in flight, not a ruling.

- Branch `feat/indicator-r0r1`, worktree `C:\Users\Patrick\uct-worktrees\indicator-r0r1`
- Pushed to `origin/feat/indicator-r0r1` (backup only — **not** a deploy); local and remote
  match. ⚠️ **No tip hash is written here on purpose** — this line named one and it went stale
  within the same session, which is the exact defect this repo keeps paying for. Read it with
  `git log --oneline -1`.
- Working tree clean, and it STAYS clean across a suite run now. ⚰️ This said *"the
  `tests/fixtures/compat_harness/**` rows that show as modified are CRLF churn with an
  empty content diff — do not commit them"*, which was true and was the wrong shape of
  answer: **a standing instruction to ignore 21 dirty files every session is a defect
  with a workaround, not a defect that was fixed.** Fixed as a class in `e7ad2b7a7` —
  `.gitattributes` gained `tests/fixtures/** text eol=lf` with the 15 binaries (png/jpg/gz,
  the vendor visual-parity references) declared after it so they stay `-text`. Measured:
  every text blob was already `i/lf`, so `--renormalize` staged **zero** changes and no
  recorded hash moved; a full `test:engine` afterwards leaves `git status` empty.
- Engine suite: `cd app && npm run test:engine` → **243 files · 5,116 passed · 2 failed ·
  32 skipped** (measured 2026-09-11 at `e7ad2b7a7`; the 2 are the census floors under
  *Known reds*). ⚰️ This line said **4,956 passed** — stale by 160 tests, which is the
  hand-typed-count-beside-the-command defect this file keeps re-committing. Re-run it;
  do not quote this number either.
- ⚠️ `npm run test:engine` covers **243 files and NOT `src/components/chart/builder/`** —
  10 failing files live there, routed in the table further down. **`npm run test:chart`
  (408 files) is the front-end suite**; `test:engine` and `test:builder` are narrower
  convenience scripts. ⭐ `suiteCoverage.test.js` now asserts that every test-bearing
  directory under `src/components/chart` is reachable from SOME named `test:*` script,
  with the paths DERIVED from package.json — it fired on its first run and named four
  more unwatched directories (`chart`, `chart/legend`, `chart/pane`,
  `chart/patternShapes`), which is its own mutation proof.

---

## ✅ ITEM 7 / R5 — WHAT STANDS BETWEEN AN IR AND A PANE, MEASURED

### R5 first: `pine:text-value` now has a line, and it is not where anyone thought

```
before   {"guard":"pine:text-value","line":null}
after    {"guard":"pine:text-value","line":151,"column":1,
          "token":"f_getTablePos","locationIsStatement":true}

     150: // Maps the user-facing position string to Pine's `position.*` enum.
  >> 151: f_getTablePos(_pos) =>
     152:     _pos == 'Top Left'   ? position.top_left :
```

⚰️ **THE LINE WAS `null` BECAUSE THE NODE WAS SYNTHESIZED, NOT PARSED.** `resolve`'s
`case 'string'` already calls `locate(node.tok)`; the `string` node reaching it
carried no `tok`, so the member got a refusal with nowhere to look.
`lowerStmts` now records the statement it is lowering and the top-level catch fills
the location in as a FALLBACK, marked `locationIsStatement: true` — ⛔ **kept as a
distinct flag rather than smoothed over**, because a fallback pretending to be exact
would send the next reader to the wrong sub-expression with full confidence.

⭐⭐ **AND IT IS A SEPARATE GAP FROM THE TABLES.** The expectation going in was
`str.tostring` on a series feeding a table cell, somewhere in 394-431. It is not:
it is line **151**, a user-defined function whose parameter is compared against
**string literals** to map a position NAME to a `position.*` enum. `_pos` comes
from an `input.string`, so every comparison is a bind-time constant and the whole
ternary chain folds to one enum — **the same class as the Kind-4 fold that already
works** (`str.contains(syminfo.ticker, "/")` at line 222). It is about where a
table SITS, not what a table SAYS. The R2 text layer is still a later, separate
piece of work.

### The gap list: IR builds → pixels on a pane

| # | what is missing | where | estimate |
|---|---|---|---|
| 1 | **`buildRuntimeIr` refuses at all.** First blocker is the bind-time string compare above; unknown what follows it — the IR lane has never been walked past this point on this script. | `pine.js::resolve` `case 'string'`, reached from `pineRuntimeFrontend` | 60 min to fold it; **unknown** for whatever is behind |
| 2 | **Nothing imports the renderer.** `pineRuntimeFrontend.js` has **zero** non-test importers, held there deliberately by `pineRuntimeFrontendGate.test.js` (3/3 green). | — | the gate's own ending: build #3, then DELETE the gate in the same commit |
| 3 | **No producer for `opts.newestBarIsForming`.** Not one caller of `interpret()` in `app/src` sets it; the pane's own path (`binder.js` → `nativeRegistry.computeFor` → `interpret`) carries `{ sym, tf }` and stops. Without it the four CLOCK_REALTIME `barstate.*` columns render **blank**. ⭐ The producer EXISTS for the SERVED lane (`521a52816`, `9dfe101e0`) — what is missing is the JS lane's path to it. | `binder.js`, `nativeRegistry.js`, the `/api/bars` response shape | 90 min, and it is **decision 3.3**, not just work |
| 4 | **The R2 text layer**, for what the tables SAY: `str.tostring` on series values (173, 393, 480, 538, 541, 542, 555, 564) and `table.*` ×10 (489, 490, 498, 502, 532, 533, 573-575). | the presentation layer | ~180 min, CUT tonight |
| 5 | **`barstate.islast` never clears** (429, 450) — refused by ruling, not by gap: its answer moves with how many bars were fetched. So the honest target for this script is *every refusal cleared except `islast`*. | — | n/a, by ruling |

⛔ **AND THE TWO LANES ARE NOT ONE LANE.** `translatePine` (definition lane →
`binder` → a pane, which is LIVE for the builder's own definitions) and
`buildRuntimeIr` (the full runtime IR lane, zero importers) refuse for DIFFERENT
reasons on this script: `pine:request@259` and `pine:text-value@151`. Tonight's work
moved the first; the second is untouched. **Which lane the pane goes through is
itself a decision**, and the definition lane is the only one with a live pane door.

## ✅ ITEM 4 — THE TUPLE `request.security` IS BUILT, AND VOLUME'S LAST BLOCKER IS ONE LITERAL

**`[a, …, h] = request.security(sym, tf, f(), lookahead)` now hands out its parts.**
Volume's line 259 is an eight-value one, and the corpus writes this call in 42 of
its 63 destructures.

⭐⭐ **THE DESIGN CLAIM IS THAT IT ADDS NO SECOND AUTHORITY.** Element k resolves in
the inner call's own scope and is then handed to `securityAsNode` **to wrap** —
through a single new `resolveInner` parameter, one substitution point. So *whose
bars*, *which period*, *lookahead*, and the rule that `sym` must sit OUTSIDE `tf`
are all still decided by the method the scalar form uses. A tuple request cannot
mean something a scalar request would not.

Measured, both lanes:

```
own symbol, 'W', off        -> tf(high, 'W')                    element 1, its own node
lookahead_on               -> tf_live(close, 'W')               INHERITED, no rule rewritten
other symbol "SPY"         -> sym('SPY', tf(close, 'W'))        sym OUTER, by construction
timeframe.period           -> close                             the identity, as for a scalar
inside an `if` branch      -> ok                                through item 2's shared reader
unrecognised lookahead     -> pine:request                      REFUSED
computed timeframe         -> pine:request                      REFUSED
3 names for a 2-tuple      -> pine:tuple                        REFUSED
```

### 🔴 AND VOLUME'S REMAINING HOST BLOCKER IS NOW EXACTLY ONE THING

```
before item 2   pine:reassign@250   volD
after item 2    pine:reassign@260   volD
after item 4    pine:request@259    the tuple request itself
```

**It is the literal `'D'`.** `TF_RESAMPLABLE` is `['W', 'M']` *because the base bar
IS a day* — there is nothing to resample a day from. `timeframe.period` is
recognised as the identity (measured above); a literal `'D'` is not. On a
daily-base engine those are arguably the same request, and Volume's whole
`isDaily ? direct : request` split exists only because a TradingView chart can be
intraday while this engine always evaluates daily bars.

⛔ **I did not take that decision.** Widening it changes what every imported
script computes, and our `tf` is `lookahead_off` + `[1]` — the last CLOSED higher
bar — so "identity" and "last closed day" differ by one bar on an intraday chart
even though they coincide on a closed-bar daily engine. That is a member-visible
semantic, so it is routed as decision **3.5** with the others rather than decided
at 21:30. Until it is taken, the refusal is the honest answer, and there is a
control asserting it.

### Evidence

- `pine.security.test.js` 22 → 31 tests; engine suite **5,135 passed · 2 failed ·
  32 skipped** (the 2 are the census floors) — **zero new failures**
- **mutation-proved by hand**: disabling the binding turns **8 of the 9** new tests
  red. ⭐ The three controls that name `pine:request` flip too, because without the
  binding everything collapses to `pine:tuple` — so those controls pin the GUARD,
  not merely "it refuses", which is the difference between a control and coverage
- ⚠️ **one self-inflicted debug cycle, recorded:** `positionaliseSecurityArgs`
  returns NODES, not `{name, value}` wrappers (`slots[at] = a.value` is the
  unwrap), and reading `.value` off one again made every condition quietly false.
  The refusal then looked like a capability gap rather than my own typo — which is
  why the shape of a returned value is now stated in a comment at that line.

## 📐 R6 — MERGE DRY-RUN: **FOUR CONFLICTS**, and the 150-270 min estimate was far too high

Measured 2026-09-11 in a throwaway detached worktree (created, measured, aborted,
removed — `indicator-r0r1` was never touched; `git status` 3 entries before and the
same 3 after, all unrelated work in progress).

```
origin/master                      36596a88a13ac0e1a90f089306cda98f4c806576
behind / ahead                     549 / 314
git merge --no-commit --no-ff      exit 1
conflicted files (UU)              4
added by master (A)                706
modified (M)                       221
```

**The four:**

| file | why it conflicts | resolution |
|---|---|---|
| `.gitattributes` | master also edited it; my R1 block is an append | **keep both** — the two additions are disjoint |
| `.gitignore` | same shape | keep both |
| `api/services/ticker_explain.py` | the `_DOMAIN_FETCHERS`-bound-twice file, fixed on both sides | read both; this branch's side is the `test_no_shadowed_definitions.py` fix |
| `app/src/components/screener/reachable.test.js` | the reachability rail's acknowledgement list moved on both sides | **union the lists**, then run it — a merged acknowledgement list is exactly the artifact that drifts |

⭐⭐ **SO TOMORROW'S ESTIMATE DROPS FROM 150-270 MIN TO ROUGHLY 45-90.** Four files,
and two of them are append-vs-append. The cost is not the conflicts — it is the
**re-verification after**: both full lanes plus the rails, the Python killed-chunk
count back at zero, and the JS byte-identical claim re-derived rather than carried
forward. ⛔ Ruling stands: **merge, not rebase** — 314 commits rewritten against 549
is not a Friday-night operation, and now it does not need to be.

⚠️ One artifact of the dry run worth knowing: while the merge was conflicted, every
git command printed `origin/master is not a valid attribute name: .gitattributes:112`
— git was parsing the conflict marker `>>>>>>> origin/master` as an attribute rule.
Harmless, and a useful tell that `.gitattributes` is among the conflicts.


## 📋 R2 — THE `builder/` ROUTING TABLE, AND THE CENSUS FLOORS ARE **CORRECT**

### ⛔⛔ THE CENSUS VERDICT IS NEITHER OF THE TWO OPTIONS: THE FLOORS ARE RIGHT AND THIS WORKTREE IS UNDER-PROVISIONED

The ruling asked whether the census **regressed** or the **floor was stale**. Measured,
it is a third thing, and the evidence is in the corpus's own `.gitignore`:

```
tests/fixtures/pine_oos/  .pine ever ADDED across all history : 30
tests/fixtures/pine_oos/  .pine ever DELETED                  : 0
tests/fixtures/pine_oos/MANIFEST.json  entries                : 60
tests/fixtures/pine_oos/.gitignore     .pine lines            : 30
tests/fixtures/oos2_parity/  added: 0   deleted: 0
```

And the `.gitignore`'s own header says why: *"Scripts whose recorded licence does not
contemplate redistribution. They are frozen, measured and hashed like every other
corpus member — MANIFEST.json carries each one's source URL and SHA-256 — but their
text is held locally only and never committed. Re-fetch from the manifest URL and
verify against sha256_source."*

⭐ **So "the frozen 60" IS sixty — 30 committed + 30 licence-restricted.** The floors
(`60`, `> 150`) are **correct and must NOT be lowered**: setting them to 30 and 129
would bake half a corpus into the repo as the truth and every future measurement
would silently be over half a corpus. ⛔ The ruling said *"raise the floor to the
measured value, never below"* — that assumed measured > floor, and here measured is
**below** because the instrument is missing half its input. Lowering is the one thing
that must not happen, so **nothing was touched**. The recovery path is real and
documented: re-fetch the 30 by `source_url` and verify `sha256_source`. That is a
network fetch of third-party scripts and a corpus-provisioning decision, so it is
the owner's, not a 22:00 call.

⛔ **No placeholder fixtures were created** — a placeholder would make the red go
away and the measurement meaningless.

### The 9 remaining `builder/` files, one row each

| file | failure, verbatim | owner | class |
|---|---|---|---|
| `documentSize.measure.test.js` | `expected 8 to be greater than 10` · `ENOENT … high_engagement__03-supertrend-kivancozbilgic.pine` | master | floor + fixture-missing |
| `graphSize.measure.test.js` | `expected 7 to be greater than 10` · `ENOENT … high_engagement__03-…` | master | floor + fixture-missing |
| `objectDemandCensus.test.js` | `expected 30 to be 60` | master | floor (the 30/30 split above) |
| `visualDemandCensus.test.js` | `expected 30 to be 60` | master | floor (same) |
| `objectLadder.test.js` | `ENOENT … long_tail__16-spy-position-helper.pine` ×2 | master | fixture-missing |
| `visualParitySet.test.js` | `ENOENT … mid_engagement__09-relative-volume-breakout-context.pine` | master | fixture-missing |
| `BuilderSheet.pine.test.jsx` | `TypeError: Cannot read properties of undefined (reading 'id')` | **unknown** | logic |
| `ImportBox.thinkscript.test.jsx` | `Unable to find an element by: [data-testid="import-suggest"]` | **unknown** | logic (UI) |
| `pineBoxSuggestVoice.test.jsx` | `wma: expected null to be truthy` · `[data-testid="import-suggest"]` ×2 | **unknown** | logic (UI) |

**The three missing fixtures, named:** `high_engagement__03-supertrend-kivancozbilgic.pine`,
`long_tail__16-spy-position-helper.pine`, `mid_engagement__09-relative-volume-breakout-context.pine`.
All three are **in the `.gitignore`'s licence-restricted list** (`git check-attr`/`git
check-ignore` confirm), so they should have come from a local re-fetch, never from git.

✅ **`criteria.nodeTypes.test.js` is FIXED** (the Kind-4 ruling above): 10 failing
files → 9, 22 failing tests → 14.
✅ **The CRLF half of `ImportBox.thinkscript` is FIXED** — `e7ad2b7a7` — and the proof
is that the failure CHANGED rather than vanished: the `declare upper;` assertion is
gone and a different test in the same file now fails on a missing DOM node.

⛔ **The three `unknown`-owner rows are UI/logic and were not chased** — they need a
`git log` walk on the components, not a guess at 22:00. They are now covered by
`npm run test:builder` and by `suiteCoverage`'s widened claim, so they cannot hide
again.

### Lint baseline, recorded so the next session can measure drift

```
npm run lint                                 4,372 problems (4,150 errors, 222 warnings)
npx eslint src/components/chart/engine         255 problems (225 errors, 30 warnings)
measured 2026-09-11 at `b72a0bfe7` — NOT touched tonight
```

⛔ No backend lint or typecheck exists in this repo — no `pyproject.toml`, no
`ruff.toml`, no `.flake8`, no `tsconfig.json`. The Python check actually performed
tonight is `python -m py_compile` on files touched, and **no Python file was touched**
(the Pine translator is JS-only), so there was none to run.

## ✅ R2 — THE KIND-4 TEXT TRIO: THE RULING ALREADY EXISTED, ON THE OTHER LANE

⚰️ **SESSION-STATE said this wanted a product ruling. It did not — one was already
written, in Python, and this was a lane that had not been told.**
`definition_concierge._OPERAND_ONLY` already describes `str` and `symtext`, and
`ast_lint.py` / `ast_interpret.py` already carry all three names (`ast_lint.py:418`
dates it 2026-09-11). What was still red was ONE rail in the other language:
`criteria.nodeTypes.test.js`, which asks that every entry in `parse.js::NODE_TYPES`
either OPEN in a formula a member can type or be NAMED in an exempt map.

⭐ **So the JS entries MIRROR the Python ruling rather than inventing a second
one** — the defect this week's `_parse_mdy`, `barstate` and `ta.cum` incidents all
share is two authorities over one value.

**And the three do NOT get one shared ruling, because they are not one thing:**

| type | ruling | lifetime |
|---|---|---|
| `textop` | **a missing picker ROW.** `text_contains`/`text_length` answer a NUMBER (1/0, a count), so it sits wherever a number sits and every walker already prices it as one. A picker row is a DESIGN task of the same class as `tf`/`sym` — what a text row compares, against which field vocabulary. | ends when the picker gets a text row |
| `str` | **structurally unpickable, not a missing row.** `closedTable.json` rules these may appear nowhere except directly under a `textop`, and `parse.js::astHash` THROWS otherwise — *"Text is not a value in this engine; a text question answers with a number and the text never leaves it."* | outlives `textop`'s entry: giving `textop` a row gives `str` an OPERAND slot, not a row |
| `symtext` | same containment, symbol-supplied. The Python ruling says it best and is quoted rather than paraphrased: *`syminfo.ticker` is not a screen condition, `contains(syminfo.ticker, "/")` is.* | as `str` |

⛔ Three entries, not one shared "text" exemption — the file's own rule about
`tf`/`sym`: one entry covering both keeps excusing the second after the first
stops needing it. And all three are exempt from the PICKER census ONLY; none is
exempt from the bind-time fold that is the whole reason they exist
(`uncharted-volume.pine:222` is `str.contains(syminfo.ticker, "/")`, and it folds).

`criteria.nodeTypes.test.js` 13 → 16 tests, green. Builder suite 10 failing files
→ 9, 22 → 14 failing tests.

## ✅ ITEM 2/3 — THE REASSIGN FOLD, AND VOLUME'S REFUSAL MOVED TO ITS NEXT LINE

**The gap was never "reassignment". This engine has TWO walks and only one of them
could read a tuple destructure.**

- the TOP-LEVEL walk has read `[a, b] = f()` since Kind 4
- `foldStatements` — the folder for the INSIDE of an `if` — never learned it at
  all, so the statement fell through to the bare-expression arm,
  `parseWholeExpression` met the `=`, `foldIfChain` threw, and every outer `var`
  the branch assigned was forced opaque as `pine:reassign`

That is `uncharted-volume.pine` 247-261, and the refusal named `volD` — a name
whose own statement is perfectly fine. Isolated before a line was written:

```
A  destructure inside `if`, then reassign outer var   -> pine:reassign   REFUSED
B  same destructure at TOP level, then reassign       -> ok
C  two branches, both reassign                        -> pine:reassign   REFUSED
D  reassign then read v[1]                            -> pine:reassign   REFUSED
E  reassign from a plain call inside `if`             -> ok
```

⭐ **Fixed by EXTRACTING one reader (`destructureBindings`), not by adding a second
branch.** Two walks disagreeing about one construct is the defect this repo has
paid for three times in a week; a copy in the folder would have been a fourth.
The `kind === 'tuple'` check carried over unchanged — it is the whole safety of
the feature, because `request.security` is 42 of the corpus's 63 destructures.

### ⭐⭐ THE REFUSAL MOVED, WHICH IS THE METRIC THE LINEMAP ASKED FOR

```
before   VOLUME [host] ok=false refusals=1   pine:reassign@250  volD
after    VOLUME [host] ok=false refusals=1   pine:reassign@260  volD
```

Line 250 is the `isDaily` branch — `f_getDailyData()`, a user tuple function,
now folds. **Line 260 is the `else` branch, whose right-hand side is the 8-tuple
`request.security` at line 259.** `linemap-volume.md` predicted exactly this:
*"The refusal list will grow as earlier blockers clear — a shrinking list is not
the metric here, a changing one is."* Blocker 1 of 3 cleared; blocker 2 is now
named at its own line and is item 4.

Screener lane unchanged: `ok=true`, 4 × `ta.cum@225`.
`buildRuntimeIr` unchanged: `pine:text-value`, line `null`, 0 columns — item 7/R5.

### Evidence

- engine suite **5,126 passed · 2 failed · 32 skipped** (the 2 are the census
  floors); baseline before the change was 5,116/2 — **zero new failures**
- 8 new tests in `pine.tuples.test.js` (26 → 34), of which **3 are refusal
  controls**: `request.security` in a branch still refuses, a names-vs-arity
  mismatch still refuses, a non-call right-hand side still refuses
- **mutation-proved by hand, never by `git checkout`**: disabling the fold branch
  turns exactly 4 of the 8 red and leaves all 3 controls green — the controls
  refuse either way, which is what makes them controls rather than coverage
- ⚰️ **my own agreement test was wrong first, and the engine was right.** It
  compared the in-branch form against the same assignment at TOP level and
  expected one formula: `accum(0/0, barindex > 0 ? close : self, 250)` against
  `accum(0/0, close, 250)`. Those are two different PROGRAMS — the branch version
  carries the var when the condition is false, which is what Pine means. The test
  now holds the branch constant and varies only the destructure, with a companion
  control asserting the conditional form does NOT equal the unconditional one, so
  a folder that flattened the `if` away could not pass both.
- **No Python mirror exists** — the Pine translator is JS-only (`pine.js`), so
  nothing Python was touched and no `py_compile` was owed by this change.

⚠️ **A stale claim found next door, not fixed here:**
`api/services/user_definitions.py:274` says *"translatePine refuses ta.cum in
BOTH modes today"*. Measured tonight: the HOST lane does not refuse it at all
(0 refusals); only the screener does, 4 times. A decision record resting on a
number that has moved.

## ⚠️ RULING 3.5 — BUILT AND MEASURED, **NOT LANDED**: 12 artifacts still encode the old ruling

**The implementation works.** Measured, both lanes:

```
'D' on a DAILY base              -> the identity: plain `close`, no step-back
'D' == timeframe.period spelling -> byte-identical ASTs (the "two spellings" gap, closed)
'D' on a 60-minute base          -> pine:request, the SAME sentence as any unservable tf
'60' on a 60-minute base         -> the identity (the rule follows the BASE, not the string "D")
intraday base + forming bar      -> REFUSED by the guard, with a closed-bar control proving the fold works
fold disclosed on the output     -> baseTimeframeFolds [{requested:'D', base:'D', line:3}]
nothing folded                   -> [] (the control: a channel that always reports tells you nothing)
the TUPLE form                   -> inherits all of it (Volume line 259's shape)
```

`BASE_TF` is **derived**, not typed: the ladder rung below the lowest resamplable
entry, and it throws if `TF_LADDER` and `TF_RESAMPLABLE` ever stop agreeing.
Divergence row `request-security-base-period-identity-vs-lookahead-off-step-back`
added at status **accepted**, with the `probe.under_ours` / `under_theirs` /
`discriminates` shape the `vendorTruth` rail requires.

⛔⛔ **AND IT IS NOT A REVERSAL OF THE 2026-09-01 RULING — I ALMOST MISSED THAT.**
`interpret.js` carries a dated ruling that `D` is absent from `TF_RESAMPLABLE` **on
purpose**, and records that it was built, moved a corpus 43 → 44, and was **reverted**
for the one-bar step-back (`tf` reads the last CLOSED period, so `tf(close,'D')` on a
daily base answers YESTERDAY — measured `[null,10,11,12,…]` against `[10,11,12,13,…]`).
3.5 is the OTHER path: the identity, which has no step-back, and which
`request.security(own, timeframe.period, expr)` has emitted for months. **`D` is still
absent from `TF_RESAMPLABLE`.** My decision doc did not surface that prior ruling
because I read the constant's VALUE and not the comment above it.

### 🔴 WHY IT IS NOT COMMITTED AS GREEN: the blast radius is 12 tests in 9 files

Every one of them encodes the behaviour the ruling changed. Two were mine and are
fixed (`vendorTruth`'s row schema, `pine.tuples`' control re-pointed at `'5'`). The
remaining twelve split in two, and **half are not mechanical**:

| file | what it asserts | mechanical? |
|---|---|---|
| `interpret.tfDaily.test.js` | *"so `request.security(_,'D',_)` refuses, and names the ladder"* — **the 2026-09-01 ruling's own test** | ⛔ **no** — rewriting a prior ruling's test wants the owner's eye |
| `doorScorecard.test.js` ×2 | *"no ruling names a script that translates — a stale ruling hides a win"*, naming `23-higher-timeframe-ema.pine` | ⛔ **no** — the rail is CORRECTLY firing; a rulings doc needs updating |
| `pine.blindCorpus.test.js` | *"`request.security` is listed as unserved but TRANSLATES — every histogram is overstating the gap by one name"* | ⛔ **no** — same class, a roster decision |
| `pine.community.test.js` + `.guards` | the named roster moved **18 → 19** scripts translating | ⛔ **no** — this is the metric moving, and the names want reading |
| `pine.test.js` ×4 | `request.security → pine:request` cases | ✅ yes, with the ruling cited |
| `pine.timeframe.test.js` | *"D is not servable and must not translate"* | ✅ yes |
| `pine.requestOffer.test.js` | the door offers `timeframe.period` for an unresamplable tf | ✅ yes |

⭐⭐ **Two of those are staleness rails doing exactly their job** — `doorScorecard` and
`pine.blindCorpus` exist to catch "a ruling says X refuses while X now translates",
and they caught it within a minute of the change. That is the system working, and it
is also why this is not a 15-minute fix.

### The metric moved, as predicted

```
before 3.5   host 32/266   screener 46/266
after  3.5   host 33/266   screener 47/266
```

One script in each lane. ⭐ Consistent with the 2026-09-01 note that the rejected
resample path moved its corpus by one as well — the same script, reached the safe way.

### Volume, verbatim, after 3.5

```
VOLUME [screener] ok=true  outputs=5 refusals=4   4 x pine:function@225 (ta.cum, by ruling)
VOLUME [host]     ok=false outputs=5 refusals=1   pine:state@284
VOLUME buildRuntimeIr      ok=false               pine:text-value@151
```

⛔⛔ **THE FOURTH BLOCKER IS A RULING, NOT A GAP.** Line 284 is
`var float priorMaxAllTimeDaily = na`, updated at 292 to
`math.max(priorMaxAllTimeDaily, volD[1])` — a **running ALL-TIME maximum**. The
engine's accumulator is bounded; an all-time max from bar zero has no anchor, which is
**precisely what `ta.cum` already refuses by ruling** ("a running total from the first
bar, and `cum` names no anchor — a translator that picked one would be inventing the
single number the whole answer turns on"). So Volume's host lane now needs a decision
about unbounded accumulators, not more capability.

**Blocker chain across the night:** `pine:reassign@250` → `@260` → `pine:request@259`
→ `pine:state@284`. Three cleared, the fourth is a ruling.


## 🧾 CLOSE-OUT ADDENDUM — the rulings, and the final numbers

| ruling | state | where recorded |
|---|---|---|
| **3.5** `'D'` identity | **BUILT + MEASURED, WIP at `29d64a2ef` — NOT GREEN.** All three conditions done: (a) identity only when the literal equals the base, with the non-daily case keeping the refusal verbatim; (b) guard refuses on a forming intraday bar, with a closed-bar control; (c) disclosed as `baseTimeframeFolds`. **12 tests in 9 files still encode the old behaviour** → T0. | `pine.security.test.js` (10 cases), `divergences.json`, SESSION-STATE |
| **3.2** `ta.barssince` arity | **NOT DONE — deliberately deferred.** Stacking a second behaviour change on a red engine suite makes attribution impossible. ⛔ And its pre-check is owed first: `user_definitions` must be scanned for shipped 2-arg calls, which I did not run. | T0 then this |
| **3.1** axis pair | ✅ **RECORDED, DARK** | `docs/pine/barstate.md` + fixture sha |
| **3.3** four names refuse in the JS lane | **NOT DONE — same reason as 3.2.** The doctrine call is recorded; the refusal + test is T4's first half. | `DECISIONS-2026-09-11.md` |
| **3.4** member wording | ✅ **PLACED verbatim** on `pine:text-value` — the one sentence a member reads for this case. Not on the concierge's own `REFUSALS` table, which is pairwise disjoint from the translator's by design. | `pine.js` |
| **`pine_oos`** 30 local-only | **BLOCKED — and not by the network.** Page fetches (HTTP 200, 395 KB); `capture_method` is **null** and `sha256_source` hashes the Pine TEXT, so reproducing the capture needs the Pine-editor/facade route. ⛔ No scrape-and-guess: a one-byte extractor difference would report 30 sha mismatches that were mine. **Floors stay at 60.** Nothing committed from that directory. | tomorrow-morning item |
| **`switchBinding`** false comment | ✅ **CORRECTED** (`cfaa48014`); the fix routed as a corpus item | `pine.js` |
| **finding #3** (my own conflated check) | ✅ **FIXED IN THE TEST ITSELF**, not just noted: the agreement case now holds the branch constant and varies only the destructure, with a companion control asserting the conditional form does NOT equal the unconditional one — so a folder that flattened the `if` away cannot pass both. | `pine.tuples.test.js` |

### Final numbers

```
PYTHON LANE (R7 chunked, 12 chunks, sequential)
  42 failed · 23,770 passed · 56 skipped · 10 xfailed · KILLED CHUNKS = 0
  red chunks: 1, 5, 7, 8, 9, 10, 11, 12     every chunk produced a totals line
  baseline at 5d25012d2 was 40 / 23,772 — a +2 delta, and TWO OF THEM WERE MINE
  via data files, not code (divergences.json reached the JS rail and not its Python
  mirror). Fixed in a6764234e; test_vendor_truth.py now 22 passed.

ENGINE   245 files · 5,139 passed · 14 failed · 32 skipped
         2 = routed census floors · 12 = ruling 3.5's blast radius (T0)
BUILDER   81 files · 1,799 passed · 14 failed — all routed, 0 attributable to tonight
RAILS     manifestProse 9 + suiteCoverage 8 = 17 passed
LINT      4,372 frontend / 255 engine — recorded, untouched
py_compile  NONE OWED: no .py file was touched all night
```

⚠️ **`origin/master` MOVED DURING THE SESSION** — `36596a88a` → `a5173fe41`. The
4-conflict dry-run was measured against the former, so **T8 must re-measure** before
quoting it. This branch has been bitten by exactly this: "master moved twice
mid-sequence ⇒ 4 rebases".


## 🏁 2026-09-11 EVENING — THE CHECKLIST, EVERY ROW FILLED

Re-scoped goal (owner, mid-session): Volume passes `translatePine` strict AND
`buildRuntimeIr` **or the gap is named to the line**; the metric re-derived and true;
the IR→pixels gap measured; the flag scaffolded. Pane, tables, mobile and merge moved
to tomorrow.

| row | state | evidence |
|---|---|---|
| `translatePine` strict on `uncharted-volume.pine` → ok, refusals 0 | **NOT REACHED** | one refusal left: `pine:request@259`. Was `pine:reassign@250` at the start of the night → `@260` after item 2 → `@259` after item 4. Two of three named blockers cleared |
| `buildRuntimeIr` → ok | **NOT REACHED, GAP NAMED TO THE LINE** | `pine:text-value` **line 151**, `f_getTablePos` — a bind-time string compare in a UDF, not the table text layer anyone expected |
| host + screener metric re-derived, with the commit | **DONE** | **32/266 host · 46/266 screener** at `b72a0bfe7`, producer `corpusMetric.test.js`, per-script rows in `tools/corpus_metric.json`. ⭐ And tonight's work moved it by **zero** — 0 gained, 0 lost, measured against `606695633` |
| IR→pixels gap measured | **DONE** | five rows with estimates; blocker 1 named, what is behind it recorded as UNKNOWN rather than estimated |
| flag named, default OFF, one reader, flag-off test | **DONE** | `VITE_PINE_MEMBER_PANE_ENABLED`, `memberPaneGate.js`, 6 tests, ledger entry `dark`, vacuity of the 5th claim declared and controlled |
| CRLF class fixed | **DONE** | `e7ad2b7a7` + `909fb7225`; a full `test:engine` now leaves `git status` empty. Zero recorded bytes moved |
| Kind-4 trio | **DONE** | ruling mirrored from Python, 3 exempt entries with distinct lifetimes |
| census floors | **ROUTED, NOT TOUCHED — the floors are CORRECT** | 30 added / 0 deleted / 60 in MANIFEST / 30 licence-restricted in `.gitignore`. Lowering them would bake half a corpus in as the truth |
| `builder/` routing table | **DONE** | 9 files, one row each, verbatim reason + owner + class; 3 missing fixtures named; now covered by `test:builder` and the widened `suiteCoverage` |
| merge dry-run | **DONE** | **4 conflicts** against `36596a88a`; estimate 150-270 min → **45-90** |
| four product questions | **DONE, and there are FIVE** | `docs/pine/DECISIONS-2026-09-11.md`; 3.4 was already answered in Python; 3.5 is new |
| `ta.tr(true)` read | **BLOCKED — UNTESTED** | no browser rig: `list_connected_browsers` → `[]`. On Volume's own line 189, so it is a MUST, not a backlog item. **Not pinned, not guessed** |
| pin `ta.tr(true)` | **BLOCKED** | depends on the reading above |
| pane / tables / mobile 640+1024 | **NOT ATTEMPTED** | moved to tomorrow by ruling. Mobile is therefore **UNTESTED**, not "expected to work" |
| lint | **RECORDED, NOT TOUCHED** | 4,372 frontend / 255 engine at `b72a0bfe7` |
| `py_compile` on touched Python | **NONE OWED** | no Python file was touched — the Pine translator is JS-only |

### Suites at the end of the night

```
engine    245 files   5,142 passed   2 failed   32 skipped     the 2 are the census floors
builder    81 files   1,799 passed  14 failed                  all routed, 0 attributable to tonight
rails      manifestProse 9 + suiteCoverage 8 = 17 passed
```

### Three findings nobody went looking for

1. **`translatePine` THROWS instead of returning a refusal** on
   `smart-money-breakouts-chartprime__ea79c79a67.pine` (`pine:statement` out of
   `switchBinding`), in both lanes — a member-reachable crash. It also falsifies the
   comment directly above that call site, which claims `switchBinding` returns null
   for a shape it cannot take. Pre-existing; routed.
2. **The CRLF class had a fourth and fifth instance** (`thinkscript/*.ts`, and two
   harness artifacts under `tools/`). Fixed as a class, with the binaries excluded.
3. **`suiteCoverage`'s SCOPE was the defect** — it enforced one command over the
   engine while ten failing files sat in a sibling directory no script ran. Widening
   it named four more unwatched directories, `chart/pane` among them.


## ⛔⛔ 2026-09-11 EVENING — THE RE-PLAN TRIGGER FIRED: NO BROWSER RIG

**`ta.tr(true)` could not be read tonight, and it is on Volume's OWN critical path.**

Measured, twice, independently, at 21:0x ET:

```
list_connected_browsers  -> []
tabs_context_mcp         -> "Browser extension is not connected."
```

⭐ **WHY THIS MATTERS MORE THAN A MISSED BACKLOG ITEM.** `ta.tr(true)` is not a
vocabulary nicety — `uncharted-volume.pine:189` is
`_src = rangeType == 'ATR' ? ta.tr(true) : high - low`, which feeds the ATR range
and therefore the ATR table. Measured tonight in both lanes:

```
ta.tr(true)   [screener] ok=false  refusals=1  pine:builtin@3
ta.tr(true)   [host]     ok=false  refusals=1  pine:builtin@3
ta.tr(false)  both       ok=true   refusals=0
bare ta.tr    both       ok=true   refusals=0
```

So the ARGUMENT is the entire gap, and the argument changes the maths — which is
precisely why it owes a vendor reading and may not be guessed. ⛔ **It is NOT
pinned and must not be**: a plausible spelling here would be a wrong number
wearing a right name, and `ceil`/`floor` were already built and backed out this
week for owing less than this.

**Blocked by it:** the reading itself, and any pin that depends on it. **Not
blocked:** the reassign fold, the 8-tuple `request.security`, the metric
re-derivation, the IR→pixels measurement, the flag scaffold, the routing table,
the merge dry-run. The night proceeds on those.

**To unblock:** start Chrome with the Claude extension connected and signed in to
the same account, then the S1-S5 editor route in `capture-procedure.md` applies
unchanged (assert the action button BEFORE `setValue`; poll from outside in cheap
calls — a 40-second `await` inside one `Runtime.evaluate` is what wedged the
renderer on 2026-09-11).

## The owner's order of work — where it stands

> ### ✅ THE ORDER IS COMPLETE, 2026-09-11 — with two named remainders
>
> **1-5, 9-13 DONE. 7, 8, 10 completed this session. 6 is eight-of-nine.**
>
> | state | items |
> |---|---|
> | ✅ done | 1, 2, 3, 4, 5 (closed, not retried), 7, 8, 9, 10 (dark), 11a, 12, 13 |
> | ⚠️ one reading short | **6** — `ta.tr(true)` is the only Group-B name unread |
> | 📋 logged, not scheduled | **11b** |
>
> ⛔ **WHAT "DONE" MEANS HERE, AND IT IS NARROWER THAN IT LOOKS.** Items 6, 7 and 8
> are done in the sense the owner asked for — *"eight vendor readings, not eight
> guesses"* — every question is now MEASURED against TradingView and recorded with
> its probe's sha256. **Almost none of them are PINNED into the engine**, and that
> is deliberate: declaring a new BAR name owes a corpus case and re-freezes a
> cross-lane oracle, which is a priced pass of its own. `ceil`/`floor` were built
> across the table and both lanes on 2026-09-11 and backed out the same hour when
> those gates fired by name. **The readings are the deliverable; the pins are a
> separate, gated piece of work.** `docs/pine/BRANCH-PACKAGE.md` §3.5 lists every
> measured-not-pinned name with its fixture.
>
> ⭐ **Three things the backlog itself had wrong**, all found by measuring rather
> than by reading it: `year` already translated and never needed a vendor read;
> `alma` is not a missing name but a DEAD one (it does not exist in Pine v6, so
> adding it would make this engine accept what the vendor rejects); and
> `ta.barssince` is a REMOVAL — our 2-arg declaration is the wrong one.


| # | item | state |
|---:|---|---|
| 1 | Land Kind 4 | ✅ merged from `worktree-indicator-ecosystem` (`cd078bbd2`), pieces verified |
| 2 | Barstate per the ruling | ✅ done end to end AND **MERGED + LANDED 2026-09-09** — semantics, calendar census, both runtimes, door, stability tests, divergence row, recorder, extended-hours rail |
| 3 | Volume through strict mode | ✅ measured, list below |
| 4 | TradingView visit | ✅ **DONE (2026-09-10 evening)** — A, B, C, D, E all captured; seven probes are SAVED SCRIPTS (`saved-scripts.json`). ⚰️ **The rest of this row was a FORECAST AND IT IS MEASURED FALSE (2026-09-10, later the same evening):** *"so every future visit is `createStudy` by id: no editor, no paste, no binding hazard"*. Seven variants were tried and every one refused — the table is in `docs/pine/capture-procedure.md`. ⭐ What DOES work with no chart at all: `pine-facade/translate/<id>/last` returns the vendor's own plot roster, which is the H6 shape gate (`tests/fixtures/vendor/saved-probe-integrity-2026-09-10.json`, all seven pass). Adding a study still needs the editor route |
| 5 | SAR memoisation | ✅ **CLOSED 2026-09-10 — NOT BEING RETRIED, and the reason is a measurement.** The memo was built in this wave and DISCARDED: it silently dropped `accum(...)` from four supertrend-family scripts — same guards, `ok:true` both ways, a formula that had quietly stopped being stateful — caught only by a byte-for-byte corpus comparison against the previous translator. It also bought almost nothing (2 cache stores on SAR); the whole **11.6s → 43ms** came from the depth bound, which is shipped with three tests and a 1,000 ms regression ceiling. ⛔ Re-attempting it re-introduces a KNOWN-WRONG result for a win already banked elsewhere, so it needs a new reason, not a new attempt |
| 6 | Group B (eight names) with fixtures | ⚠️ **EIGHT READINGS TAKEN 2026-09-11; `ta.tr(true)` STILL UNREAD.** Read off three probes ALREADY on the layout — no adds needed: `ta.highest(n)`→**high** and `ta.lowest(n)`→**low** (0 on all 405 bars, confirming what RULING H shipped) · `ta.pivothigh`→**high**, `ta.pivotlow`→**low** · `math.round` is **half away from zero** (2.5→3, −2.5→−3, 0.125→0.13 — not bankers'), confirming the hand-written `_guarded_round` in both lanes · `math.max`/`min` are **VARIADIC** (5 args) while our table declares 2 — an arity gap pointing the OPPOSITE way to `ta.barssince` · `ta.vwap()`→**hlc3**. Every reading carries a non-zero SPREAD control, because each answer is a difference that measured zero and so is a study that never ran. `tests/fixtures/vendor/groupb-readings-spy-1d-2026-09-11.json`. ⚰️ The rest of this row was: **UNBLOCKED, NOT DONE** — still "eight vendor readings, not eight guesses", and `ta.tr(true)` is still the template (the argument CHANGES THE MATHS). ⭐ The stated blocker — *"the same editor binding as item 4's C/D/E"* — is gone, but a DIFFERENT one replaced it: five Group B probes are authored and three are saved, and the three unrun readings (pivothigh/low, math.round, math.max variadic, vwap 1-arg) are blocked on the add mechanism refuted under item 4. `ta.highest`/`lowest` defaulting — the 81-site question — is authored and SAVED (`UCTPROBE_GB_HILO`, roster 11 confirmed against the vendor) and still unread |
| 7 | `time(timeframe)` + `ta.valuewhen` | ✅ **ALL EIGHT QUESTIONS READ 2026-09-11.** `time(tf)`: Q1 `time("W")` on a daily chart is the FORMING week's open, never `na` (constant across 3 consecutive days while the bar advances) · Q2 `time(timeframe.period)` is EXACTLY `time`, delta 0 on 610 bars · Q3 with a session argument is `na` OUTSIDE and the bar's own time INSIDE · Q4 the new-day idiom folds, 610/610 and `na`-free. `ta.valuewhen`: occurrence 0 is **INCLUSIVE** (122/122 on the discriminating bars, 0/122 exclusive — 381 sites rode on this) · occurrences count FIRINGS (step exactly 5, the only value) · never-fired is **`na`**, not 0. Four capture fixtures. ⛔ None PINNED — the semantics are a member-visible decision, routed with the measurements. ⚰️ The rest of this row was: **Q3 ANSWERED 2026-09-11; Q1/Q2/Q4 AND valuewhen STILL UNREAD.** ✅ `r11-time-session.pine` was added on a 5m chart and read: `time(tf, "0930-1600")` is **`na` outside the session and the bar's own `time` inside it**, never the session start — so the corpus's two-argument sites are a MEMBERSHIP TEST, and the `na`-ness is the whole signal (`tests/fixtures/vendor/r11-time-session-spy-5m-2026-09-11.json`). It COMPILES, which was a real fork. ⛔ The first attempt was VACUOUS and looked conclusive — on the default `regular` session every bar is in-session, so `na` had no bar to be false on; the probe's own hour/minute channels caught it and the capture was retaken on `extended`. ⚰️ The rest of this row was: **PROBES AUTHORED 2026-09-10, READINGS NOT TAKEN** — all eight questions of `r11-time-and-valuewhen.md` are now committed as three probes, split so one risky arity cannot take the others down: `r11-time-tf.pine` (Q1/Q2/Q4, 10 plots), `r11-time-session.pine` (Q3 alone — the two-arg session form; ⛔ read it INTRADAY or every bar is inside the session and it answers nothing), `r11-valuewhen.pine` (12 plots, and it carries its own oracle: `bar_index % 5 == 0` makes the right answer computable, with the inclusive/exclusive discriminating bars marked). Blocked on the same add mechanism as item 6 |
| 8 | Remaining real names in demand order | ✅ **ALL NINE READ 2026-09-11** — `ta.nvi` seed=1 + rule (209/209, 190/190) · `math.pi` PINNED · `year` already translated (clock = exchange time) · `alma` DOES NOT EXIST in v6 · `math.ceil` toward +∞ · `math.floor` toward -∞ · `ta.barssince` ONE arg, 2-arg REJECTED, never-true = `na` · `ta.correlation` and `ta.percentile_linear_interpolation` `na` until the window fills, percentile CLAMPS 610/610. Five capture fixtures; table in `r11-remaining-nine.md`. ⛔ Only `math.pi` is PINNED — it folds to a number; every other name declares a BAR name and owes a corpus case (the gate that stopped `ceil`/`floor`). ⚰️ The rest of this row was: **NOT DONE, AND "CHEAP TO TAKE" NO LONGER HOLDS** — it rested on the by-id add refuted under item 4. Still "a vocabulary backlog, not an unlock plan"; the next visit should fix the add route FIRST, because items 6, 7 and 8 are all queued behind that single mechanism |
| 9 | Group C order-asserting rail | ✅ **DONE** (`771a101ac`) — asserted on ORDER over pine.js's AST, with two non-vacuity controls; mutation-proved |
| 10 | M1 — Volume's numeric plots as a pane behind the flag | ✅ **DONE, SHIPPED DARK 2026-09-11** — gate `VITE_VOLUME_NUMERIC_PANE_ENABLED`, default OFF, read in exactly one place (`placement.js::volumeNumericPaneEnabled`). With it on, a definition overlaid onto the volume pane skips the shared LEFT axis and falls through to the Flip-C branch: its own pane, its own right-hand scale, its own ladder. 11 tests, mutation-proved (deleting the gate turns 3 red). ⚠️ The NAME is an assumption — see "Decisions taken autonomously" below — because the owner's §6 was truncated and the tail never came. ⚰️ The rest of this row was: **BLOCKED ON THE OWNER** — §6 was truncated mid-sentence at "Feature fl…"; the runbook says ask for the tail before starting M1 |
| 11 | **NYSE calendar cross-lane parity** — see below | ✅ **11a DONE** (`1c98b4493`) — the rail already existed and the sets AGREE; two blind spots closed. 11b still logged |
| 12 | `record_clock_parity.py --check` in CI | ✅ **DONE** (`86e31c706`) — red observed on a perturbed fixture, then reverted |
| 13 | live window reads the calendar leaf | ✅ **DONE** (`2a89bf997`) — half-days shorten the window to 13:00 ET; discriminator + control mutation-proved |

⛔⛔ **WHAT IS STILL GATED IS THE RENDERER, NOT THE ITEMS.**
`pineRuntimeFrontend.js` may not be wired to any route until a producer feeds
`opts.newestBarIsForming` from Python's `bar_close_state`. Until then the JS lane
renders CLOCK_REALTIME blank by design.

⚰️ **THIS SAID "ITEMS 6-10 ARE GATED" AND THAT READ AS A BLOCKER ON THE WORK.** It
was not: items 6, 7, 8 and 10 were all completed on 2026-09-11 without wiring that
module at all — the readings come off a chart through the editor route, and item
10's pane is a placement decision behind its own dark flag. What this gate stops
is one specific thing: **a member meeting four blank columns.** ⭐ The producer
EXISTS for the served lane (`521a52816`, `9dfe101e0`); what is missing is the JS
lane's own path to it, and `pineRuntimeFrontendGate.test.js` is still 3/3 green
with zero importers, so nothing has drifted.
Measured: at `35ba654da` the lane was already blank; at `3a1d9d4a3` it was
confidently wrong. Enforced by
`app/src/components/chart/engine/__tests__/pineRuntimeFrontendGate.test.js` —
when it goes red, build the producer and delete the test in that same commit.

### Item 11 — the JS-side NYSE calendar (logged, deliberately NOT in this merge)

⛔ **`app/src/lib/marketClock/nyseCalendar.js` IS OUT OF SCOPE FOR THE BARSTATE MERGE.**
Owner ruling 2026-09-09: do not touch it or its six consumers. It ships
`NYSE_HOLIDAYS_2026/2027` **and** `NYSE_EARLY_CLOSES_2026/2027` as code and is
load-bearing for `useMarketOpen`, `StockChart`, `sessionModel`, `sessionStale`,
`useBrokerMarkPreference`, `EarningsCard`, `weekAnchor`, `ChartDayGain`,
`GridChartCell` — deleting it breaks live UI.

⚠️ It is nonetheless a **second authority over the same NYSE dates, in a second
language** — the exact hazard the barstate seam ruling is built around, sitting one
directory away. It predates this wave and is not something this merge introduced.

- **11a.** A cross-lane PARITY test: `nyseCalendar.js` full closures ==
  `ast_interpret._nyse_full_closures()`, early closes ==
  `liveflow_monitor._NYSE_EARLY_CLOSES_YYYYMMDD` — as SETS, asserted in BOTH
  directions so neither lane may carry a date the other lacks. Runs in the JS suite,
  either off a small JSON the Python side emits or by reading both files directly.
- **11b.** Later, not now: GENERATE `nyseCalendar.js`'s data from the Python sets so
  there is one hand-maintained source and the parity test becomes structural rather
  than a diff.

⛔ Nothing is written for item 11 in this merge beyond this entry.

Also outstanding from the owner's §3: apply the *"guard shipped unable to fire"* control rule
**retroactively to the object pool and the licence rail**.

---

## ✅ Item 4 — DONE. What was "blocked" and what it actually was (2026-09-10)

⚰️ **THIS SECTION SAID THE VISIT WAS BLOCKED ON `document.visibilityState === 'visible' &&
document.hasFocus()`, AND THAT WAS THE WRONG DIAGNOSIS TWICE OVER.** The hidden-tab gate was
already retired on evidence (`0daa7d1fd`); what remained was a claim that a new study needed a
human paste and a human unbind. Neither is true.

⭐⭐ **THE FOUR PROBES ARE SAVED TRADINGVIEW SCRIPTS.** Ids, receipts and the capture
procedure live in `tools/visual_conformance/probes/saved-scripts.json` — read them from there,
never from prose:

| probe | saved as | plots | state |
|---|---|---:|---|
| `fold-pass.pine` | UCTPROBE_FOLD | 5 | ✅ compiles, on chart |
| `tuple-security.pine` | UCTPROBE_TUPLE | 26 | ✅ compiles, on chart |
| `barstate-full.pine` | UCTPROBE_BARSTATE_FULL | 26 | ✅ compiles, on chart |
| `exchange-spelling.pine` | UCTPROBE_EXCHANGE | 11 | ✅ compiles, on chart (v1 did not — see below) |

**Every future visit is `createStudy` by id.** No editor, no paste, no binding hazard, no
person. Per probe the route was: script-title dropdown → Create new → Indicator (the unbind —
three pointer clicks, not a human action), `model.setValue()` through the Monaco handle,
sha256-verified IN THE EDITOR against the committed file, Save, Add to chart.

**Captures landed:** A (Aroon) and B (fold numeric) earlier; then
- **C** — `exchange-spelling-seven-witnesses-2026-09-10.json`
- **D** — `barstate-full-spy-1d-closed-2026-09-10.json`
- **E** — `tuple-security-spy-1d-closed-2026-09-10.json`

⛔⛔ **AND THE EXCHANGE PROBE COULD NEVER HAVE RUN.** `syminfo.exchange` is not a Pine v6
identifier — the vendor answers `CE10272`. The field is `syminfo.prefix`. Renamed everywhere on
a measurement (0 uses of the old name across all 502 tracked `.pine` files, with an R6 control
proving the reader could see it), N11 deleted as vacuous, and `symbolScope.json::confirmed`
filled with six witnessed rows. Both vendor fields now SERVE for the yfinance leg of our store.

⚠️ **WHAT STILL NEEDS MARKET HOURS.** Job E's N23 (the HTF arm, the only place the
gaps × lookahead combinations can diverge) and the D-realtime run both need 09:30–16:00 ET.
The closed-session run finished at ~17:05 ET, and its four equal gaps/lookahead readings
discriminate nothing — recorded as measured, explicitly not as an answer.

⛔ **What a hidden tab does and does not cost** is written up in `capture-procedure.md` —
value reads are immune, **adding a study is not**, and `insertStudy` reports success while
inserting nothing. That file also now carries FOUR THINGS THAT LOOK LIKE SUCCESS AND ARE NOT,
each hit in this session: a failed study keeps a one-plot stub whose roster reads fine; the
vendor stores CRLF so a naive sha compare fails on every script and means nothing; plot rosters
need a balanced-paren scan, never a regex (the third regex under-count in two days); and the
action button is icon-only in some states with an x that moves within a session.

---

## Volume's refusal list — verbatim, as of the barstate work landing

```
SCREENER (default)     ok=false  refusals=5
    pine:function  line 225  token `ta.cum`
    pine:function  line 225  token `ta.cum`
    pine:function  line 225  token `ta.cum`
    pine:function  line 225  token `ta.cum`
    pine:window    line 233  token `isWeekly`
HOST / pane (strict)   ok=false  refusals=4
    pine:window    line 233  token `isWeekly`
    pine:window    line 233  token `isWeekly`
    pine:window    line 233  token `isWeekly`
    pine:reassign  line 250  token `:=`
```

⚠️ **`strict: true` is HOST/pane, not screener** — an earlier report in this wave had the two
labels inverted. The list above is the corrected one.

All five `barstate.*` sites (296, 299, 399, 429, 450) translate now. `ta.cum` refusing for a
screen and not a pane is the `window_dependent` ruling working. `pine:reassign` at 250 is new
and expected — it was always there and translation never reached it because barstate refused
first. `pine:window` 233 is the bind-time fold, the **other session's** work.

## Three-number metric: **32/266 host · 46/266 screener** — re-derived 2026-09-11

⚰ **SUPERSEDED TWICE SINCE — read the R-F section at the top of this file.** Ruling 3.5 took it to 33/266 · 47/266 and ruling R-F to **31/266 · 46/266** (2026-09-12). The producer is still `corpusMetric.test.js` and the artifact is still `tools/corpus_metric.json`, whose `measured_at` is now derived from the run rather than typed. This heading is kept because the paragraphs under it are the record of how the first drift was found.

⚰️ **IT READ 30/266 · 45/266 AND HAD BEEN STALE SINCE BEFORE TONIGHT.** Measured at
`b72a0bfe7` by `corpusMetric.test.js`, which is now the producer — the old pair came
from an ad-hoc run nobody could repeat, which is how it drifted through at least two
capability landings with nothing able to report it.

⭐⭐ **AND TONIGHT'S ENGINE WORK MOVED IT BY ZERO, MEASURED RATHER THAN ASSUMED.** The
same corpus was run against tonight's starting tip (`606695633`) and against HEAD:
host 32 → 32, screener 46 → 46, **0 scripts gained and 0 lost**. The destructure fold
and the tuple `request.security` cleared blockers on `uncharted-volume.pine` — a MEMBER
fixture, not a `corpus/committed` member — and every corpus script that writes those
shapes is blocked on something else as well. ⛔ That is the linemap's lesson as a
number: a capability landing and a metric moving are different events. The 0-lost half
is also a stronger control than the suite's "no new failures".

⚠️ `translatePine` THREW instead of returning a refusal on ONE committed script —
`smart-money-breakouts-chartprime__ea79c79a67.pine`, `pine:statement` out of
`switchBinding`, in BOTH lanes. Pre-existing (my diff does not touch `switchBinding`)
and routed below; the harness records it as `THREW` rather than swallowing it.

Barstate moved the *pane*, not the corpus: `isconfirmed` already folded for the screener, and
those scripts are blocked by `pine:function` / `pine:request` / `pine:tuple` regardless.

---


### ⚠️ THE 2026-09-11 BROWSER SESSION ENDED ON A FROZEN RENDERER — what is outstanding

Five captures landed (hi/lo, pivot, round-max-vwap, valuewhen, time-tf). Then, during
the `setResolution('5')` that the SIXTH needs, **the page reloaded under the visit**
— the tab id changed from `603418943` to `603419102` — and the renderer stopped
answering: two consecutive `Runtime.evaluate` calls timed out at 45s, 45 seconds
apart. Browser work stopped there rather than hammering it.

**Outstanding, and none of it is lost work:**

1. ✅ **`r11-time-session.pine` IS READ** — measured 2026-09-11: 400 bars, `_compiles: true`, verdict + discriminator recorded in `tests/fixtures/vendor/r11-time-session-spy-5m-2026-09-11.json`; item 7's row above owns the reading. ⚰ **THIS SAID "IS UNREAD" AND WAS STALE** — the outstanding list was written before the capture and never revisited, which is the defect class this repo keeps paying for. The superseded text: it is the last of item 7's three probes
   and the only one that needs an INTRADAY chart — `time(timeframe.period,
   "0930-1600")`, the form the corpus's **54 two-argument sites** ride on (re-measured
   2026-09-11 across 13 `corpus/committed` scripts; the **52** here had drifted by two
   — derive it, see `r11-time-and-valuewhen.md`). It decides
   whether those sites are a BOOLEAN test or an ARITHMETIC one, and a compile refusal
   would itself be the answer. The probe is committed and the route is proven; it
   needs one add on a 5m chart.
2. ✅ **V4 IS CONFIRMED — read, not assumed (2026-09-11).** The frozen tab was
   recovered with ONE navigate to the same layout URL (tab id unchanged) and then
   read before anything was touched: **`AMEX:SPY`, resolution `1D`**, `__uct*`
   globals **zero**, 13 studies of which the **8 `UCTPROBE_*` all compile with 400
   rows each**. So the interrupted `setResolution('5')` did NOT persist — the worry
   was unfounded, and recording it rather than assuming was still right, because
   the two outcomes are indistinguishable without reading.
   ⚠️ **One pre-existing failure, and it is NOT one of ours:** the study named
   `UCT marker parity probe` is in `status().type === 3` with
   *Compilation error — Undeclared identifier "{identifier}"*. It is not a
   `UCTPROBE_*` capture and predates this visit; routed, not silenced.
3. ⭐ **The layout is the disposable one and stays for the owner**, per the standing
   ruling. Nothing was written to either named script.

⭐⭐ **THE FREEZE HAS A DIAGNOSIS NOW, AND IT WAS OUR OWN CALL SHAPE.** A poll
written as a 40-second `await` loop INSIDE one `Runtime.evaluate` exceeds that
call's 45 s budget and returns as a timeout — indistinguishable from a dead page.
Reproduced deliberately this visit. **Poll from outside in cheap calls; never
write an evaluate that waits.** Recorded with the rest of the recovery discipline
and the correct study accessors in `docs/pine/capture-procedure.md`
("THE RENDERER FREEZE").

⛔ **A second instrument trap, same visit:** `si._data._items.length` inside a
`try` returns **0 for every study** — the wrapper has no `_data` — so thirteen
healthy studies read as "nothing loaded". Use `si.dataLength()` / `si.status()` /
`si._study.data().last()`. An instrument reporting its own blindness as a zero is
the shape that cost this project a day once already.

⭐ **AND THE BINDING GATE EARNED ITS KEEP.** Twice in this session the action button
read *"Update on chart"* when a naive pass would have clicked it: once after adding
`UCTPROBE_GB_HILO` (a SAVED script — the exact H1 action), and once after adding an
unsaved Untitled script. Every add binds. The gate refused before the buffer was
touched, which is the ordering that matters: check the button, THEN `setValue`.

## Known reds — routed, not silenced

1. ✅ **`tests/test_ast_interpret.py::test_the_escape_census_ZERO_is_ATTRIBUTABLE` — NO
   LONGER RED HERE.** Measured 2026-09-11 on `c04e86bb0`: green alone, green with its
   sibling rail (162 passed across the two files), and green in company across the whole
   family (`tests/test_ast_*.py` → 796 passed, 5 skipped, 1 xfailed). It was routed in
   `requests.md` as "green ALONE and red IN COMPANY", raised from
   `.claude/worktrees/indicator-ecosystem` — that entry is now **ANSWERED** with this
   control rather than closed as fixed, because the repro was never reproducible from
   this branch and the difference may be that worktree.
   ⭐⭐ **But the defect it LOOKS like is real, and RULING J1 fixed it.** "Green outside
   pytest, red under pytest, same code, different guard" is the signature of a **stack
   overflow laundered into a guard name** — and `parse.js` had exactly that: `convert`
   recursed once per node (ceiling measured at 5,468 deep on this runtime) and
   `parseFormula`'s `err instanceof TableRefusal ? err.guard : 'canonicalise:node'`
   turned the `RangeError` into `canonicalise:node`, so a chain of `+` and `1` was
   refused as an unrecognised node shape. A laundered overflow is invisible to a census:
   it is `ok: false`, it has a guard name, and it counts as refused. See `c04e86bb0`.
2. **Two census floors** — `capabilityDemandCensus` and `historyDemandCensus`, both
   `expected 129 to be greater than 150`. Diagnosed: `tests/fixtures/oos2_parity` is **empty**,
   and neither census includes `corpus/committed` at all. ⛔ **So "re-census" in items 5–8 is
   measuring 129 scripts, not 395** — worth settling before those items lean on it.

⛔ **Do not claim repo-green** while either stands.

### ⭐⭐ FULL PYTHON LANE — ZERO KILLED CHUNKS, TWICE (2026-09-11)

✅ **C1, RE-RUN AT THE END OF THE ORDER on `5d25012d2`: 23,772 passed · 40 failed · 56 skipped · 10 xfailed · ZERO KILLED.** ⭐⭐ **ZERO NEW** — the 40 are a strict SUBSET of the previous run's 44 (`comm -13` over both sorted lists is empty). Four disappeared: three `test_interventions` cases and one `test_mutation_check`, all of which had been flagged load- or order-sensitive. ⛔ **And none of them is ours**, measured rather than asserted: the 22 failing FILES and the 51 Python files this whole BRANCH touches have an EMPTY intersection.
JS full lane the same day: 1,220 files, 17,400 passed, 28 failed — the failing set BYTE-IDENTICAL to the pre-directive baseline, 28 for 28 by test name. One unhandled error (a `LineType` export missing on the lightweight-charts mock) present in the earlier run too.

✅ **RE-RUN 2026-09-11 on `769ddfb09`: 23,756 passed · 44 failed · 56 skipped · 10 xfailed · **ZERO KILLED CHUNKS**.** The run below had TEN killed, so this is the first complete traversal of the suite — nothing was lost to an OOM.
⭐⭐ **And all 44 were re-run ALONE: 35 are real, 9 pass in isolation.** The nine are named in `requests.md`, together with the confirmation that three of the four load-sensitive cases that entry already warned about reproduced exactly. ⛔ **None of the 44 is ours** — the files this directive changed and the files with failures have an empty intersection, measured rather than asserted.

⭐ The earlier reading, kept for the comparison:

Run through `tools/pytest_chunks.py`, 12 chunks, sequential, per-chunk logs, each
chunk's own exit code kept (R7). **23,687 passed · 52 failed · 55 skipped · 10
xfailed · 0 KILLED.** Nothing was OOM-killed, which is the result the runner was
built to be able to state.

⚠️ **THE RUN'S OWN FIRST TOTAL WAS WRONG AND THE RUNNER IS WHAT FIXED IT.** It
printed 46 failed / 21,817 passed, because chunk 11's summary line sat at line 407
and a daemon thread from an imported `api.main` logged 4 MB after it — past the
4,000-character tail the counts parser read. The chunk reported `(no counts)` and
its 1,870 passes and 6 failures were silently absent from the total. Fixed in
`f7870c678`; a chunk with a summary it cannot parse now shouts instead of
contributing zero. ⛔ Same defect class R7 exists for, arriving inside the
instrument built to enforce R7.

**None of the 52 is from this wave's work** — ten were re-run individually and
read, and every one names a file this session never touched. The largest cluster
is ONE root cause:

- ⚰️ **THE KIND-4 TEXT TRIO REACHED THE INTERPRETER AND NOT ITS MIRRORS.**
  `str`, `symtext` and `textop` are in `ast_interpret.NODE_TYPES` and missing from
  every artifact that redeclares that vocabulary: `ast_lint._CANONICAL_TYPES`,
  `scan_definition`'s branch list, the concierge tool schema's `$defs`, and
  `ast_scalars`/`ast_conformance`'s declarations — **7 failures, one unpropagated
  change.** ⛔ It is NOT a mechanical fix: the concierge one is a product choice
  (describe the three to members, or name them in `CONCIERGE_OMITS` as
  translated-only), so it wants a ruling rather than a sweep.
- **Inherited and unrelated**, each verified by reading its assertion: member
  fixture hashes (`uncharted-volume.pine`, `uncharted-clouds.pine` — the recorded
  hashes trail a committed edit), `financial_statements.py` missing a yfinance
  binding proof, a `vcp/engine` threshold move, an unquarantined FMP URL literal,
  two test files outside `testpaths`, an import-time `sys.modules` bind in
  `test_mobile_audit_route_validity.py`, six undeclared feature gates, and
  `ticker_explain.py` binding `_DOMAIN_FETCHERS` **twice** (lines 930 and 1000).
- ⭐ That last one is worth its own note: it is the SAME defect the `_parse_mdy`
  incident in CLAUDE.md describes — a top-level name bound twice, where Python
  keeps the last binding and the earlier one reads as authoritative while being
  dead. The rail that catches it (`test_no_shadowed_definitions.py`) was written
  for that incident and has now found a second instance.

---

## Open questions for the owner

### Open product questions

**Should the barstate columns follow the VENDOR's three axes instead of our
tri-state?** The switch is BUILT and OFF. `compute_clock` and its JS mirror both
carry `BARSTATE_MODE_VENDOR`; both replay the timeline; the default is `calendar`
and nothing member-facing selects the other.

⭐⭐ **AND IT NOW TAKES A THIRD INPUT — `dataset_live` / `opts.datasetLive`.**
Row 7 (2026-09-10 23:57 ET) falsified the branch's hard-coded assumption that the
newest bar is always the realtime one: the same daily bar that read isrealtime=1
for seven and a half hours read **0** overnight, with `ishistory` 1 and
`islastconfirmedhistory` landing ON the last bar. ⛔ The INSTANT is deliberately
NOT in the engine — it is bracketed three hours wide with no proposed mechanism —
so liveness arrives as an observation the caller makes, exactly as `confirmed`
does. The cold row is replayed by a test that asserts BOTH that the clock alone
gets it wrong and that the observation fixes it, so a later guess cannot quietly
become a shipped instant.

⭐ **What the vendor does**, measured 2026-09-10/11 on AMEX:SPY 1D: three INDEPENDENT
axes — `isrealtime` is POSITION (the newest bar of a live dataset), `ishistory` its
complement, `isconfirmed` is TIME (the closing update happened). Ours derives all
three from one boolean, so `isconfirmed` is `1 - isrealtime` by construction and the
vendor's observed 1/1/0 is a state we cannot spell. In the post-confirm, pre-open
window a member reading the same bar sees **vendor 1/1/0 vs ours 0/1/1** — two of
three columns disagree, both engines confident.

⭐⭐ **THE FINDING THAT SETTLES THE SHAPE: the two axes move at DIFFERENT INSTANTS.**
`isconfirmed` flipped in (19:22, 20:55) ET and `isrealtime` in (20:55, 23:57) ET —
hours apart, on one bar, with three intervening page loads proving it is the clock
and not the fetch. **No tri-state can express two flags that flip at different
times.** So this is not a calibration difference between us and the vendor; it is a
different NUMBER OF AXES, and that is now measured rather than argued.

⛔ **WHAT WOULD HAVE TO BE TRUE TO FLIP IT:**
1. **The confirmation instant measured, not hypothesised.** All six rows establish
   is a 93-minute bracket, (19:22, 20:55) ET. `nyse_calendar.EXTENDED_CLOSE_HOUR`
   guesses 20:00 — the extended-hours close — and derives 17:00 for a half-day,
   which is a guess about a guess. **One row between 19:30 and 20:30 ET settles it.**
2. ✅ **A pre-open row — DONE, and the answer is that it DROPS.** Row 7, 23:57 ET,
   in the overnight gap: `isrealtime` 0, `ishistory` 1. It does not stay 1 straight
   through. ⭐ **But that replaced the question rather than closing it:** the flip is
   bracketed (20:55, 23:57) ET — three hours — and unlike the confirmation instant
   there is **no hypothesised mechanism for it at all**, not even a bad one. Rows
   through 21:00–00:00 ET would close it.
3. **An early-close day**, which is the only thing that tests the derived 17:00.
4. **A decision about which is RIGHT FOR A SCREEN**, which is not the same question
   as which matches TradingView. Ours answers "is this bar's period over"; theirs
   answers "is this the live bar". A screener almost always means the first.
5. ⭐ **AND NOW: where `dataset_live` would come from in production.** Vendor mode
   needs to know whether the feed is still delivering, and this engine evaluates a
   STATIC FETCH — there may be no honest answer to give it, which is itself an
   argument for keeping `calendar`.

⚠️ Flipping it changes every barstate column a member can read, so it is a
member-visible change, not a fix.


**Should the door supply a default bound for the vendor's 1-arg `ta.barssince(cond)`
so imported scripts run instead of refusing?** Today it refuses by name:
`PINE_INEXPRESSIBLE.barssince` declines the bare call because mapping it onto ours
*"would silently cap the count — a different number wearing the same name"*, while
`contextBoundedPlan` rewrites the compared form (`ta.barssince(c) < 5` →
`barssince(c, 5) < 5`) exactly, because every count the cap destroys is one the
comparison already answers the same way. The bound is the budget — `n` is the window
the count saturates at and the whole bounded-state design is priced on it — so a
default would be choosing a number on the member's behalf and charging them for it.
Measured against the vendor 2026-09-10: Pine's takes one argument and answers `na`
where ours answers the sentinel; `divergences.json::barssince-unbounded-vs-bounded-state`
carries it at MEASURED tier with a member-facing `vendorNote`. ⚠️ **Not decided.**
The trade is a pasted script that runs with a bound nobody chose, against one that
refuses with a sentence naming exactly what to add.


1. ✅ **ANSWERED AND CLOSED 2026-09-10 — item 5's row in the table above now owns this, and this entry is kept only so the reasoning is not lost.** The memo was built in this wave and
   **discarded**: it silently dropped `accum(...)` from four supertrend-family scripts — same
   guards, `ok:true` both ways, a formula that had quietly stopped being stateful — caught only
   by a byte-for-byte corpus comparison against the previous translator. It also bought almost
   nothing (2 cache stores on SAR). The whole **11.6s → 43ms** came from the depth bound, which
   is shipped with its three tests and a 1,000 ms regression ceiling. Re-attempting the memo
   would re-introduce a known-wrong result, so it is **not** being retried without a reason.
2. ⚰️ **`symbolScope.json::confirmed` IS NO LONGER EMPTY — FILLED 2026-09-10 with six
   witnessed rows.** This read *"still empty and this wave did not fill it"*, and it was right
   at the time: the five-symbol capture read `syminfo.tickerid`, a **different field** from the
   one the map is keyed on, and filling it from that would have been the *"assertion wearing a
   data structure"* that file warns against. ⛔ **THE FIELD IT NAMED DOES NOT EXIST.**
   `syminfo.exchange` is not a Pine v6 identifier (CE10272); the exchange is **`syminfo.prefix`**.
   The binding was renamed everywhere on a measurement — 0 uses of the old name across all 502
   tracked `.pine` files — and job C's seven witnesses landed six rows, so both vendor fields
   now SERVE for the yfinance leg of our store and still refuse for the FMP free-text half.
   Capture: `tests/fixtures/vendor/exchange-spelling-seven-witnesses-2026-09-10.json`.

---

## Where the reference material lives

| topic | file |
|---|---|
| barstate semantics, calendar, stability property | `docs/pine/barstate.md` |
| rails earned this wave (incl. the swallowed-host-error rule) | `docs/pine/rails.md` |
| hidden-tab / capture rules | `docs/pine/capture-procedure.md` |
| Group B arity, measured | `docs/pine/r11-group-b-arity.md` |
| `time()` + `ta.valuewhen` demand | `docs/pine/r11-time-and-valuewhen.md` |
| the remaining nine names | `docs/pine/r11-remaining-nine.md` |
| census + Group C | `docs/pine/r11-vocabulary-gap.md` |
| vendor captures | `tests/fixtures/vendor/barstate-realtime-spy-2026-09-09.json` |
| divergence disclosure | `tests/fixtures/vendor/divergences.json` |

## Standing constraints for this wave

Open-source scripts only; never read/reproduce protected or invite-only scripts; **AGPL
projects (PineTS, piner, pyne, pinescription, vela-pinets) must not be read, vendored or
linked**; the $1,199/dev/yr licence is declined; product copy says *"supports Pine Script®"*
descriptively only; nothing shipped is named Pine.

Shared worktree: **never `git add -A`**, pathspec commits only, never `git checkout` to revert
a mutation probe, never bare `git stash`. Merge `worktree-indicator-ecosystem` at every phase
boundary and record conflicts touched.

**Pause on:** member data · a vendor contradiction (Aroon, valuewhen, the fold probe) · the
other session's files · the calendar census contradicting the screener's session logic · a real
blocker.

### R8 — COMMIT MESSAGES VIA `-F <file>`, NEVER INLINE (owner, 2026-09-11)

> Commit messages via `-F <file>`, never inline — `12d8ac77c` lost a backticked
> clause to shell substitution. Record it.

**What it cost, exactly.** `12d8ac77c`'s message explains a revert by quoting the
line that caused it:

    carriedTarget both open with `if (tree[name]) return null`, so membership …

Written inline through `printf`, the shell read the backticks as command
substitution, tried to run `if (tree[name]) return null`, printed a syntax error to
stderr, and substituted **the empty string**. The commit succeeded. The sentence in
the permanent record reads *"both open with , so membership"* — the clause naming
the exact mechanism, gone, in the one artifact written to explain it.

⛔ **AND IT CANNOT BE FIXED.** Amending a pushed commit needs a force push, which
H2 forbids. The message is wrong forever; the snippet survives only because it is
also in `pine.js` and `requests.md`.

⭐ **`-F` IS IMMUNE BY CONSTRUCTION** — the file is read as bytes, never parsed by a
shell — and it costs one extra write. Backticks, `$(…)`, `$VAR`, `!`, and a stray
`"` are all live ammunition in an inline message, and a message is exactly where
code fragments belong.

### R7 — PYTHON LANE DISCIPLINE (owner, 2026-09-10, verbatim)

> Never run a bare `pytest tests/`. The full Python lane runs ONLY via the repo's
> chunked config (the 12-chunk mode used for the F9/L4 runs), chunks sequential,
> never in parallel. Named files for anything targeted. Never read pytest's status
> through a pipe: redirect to a file, then read the file and `${PIPESTATUS[0]}` /
> the process's own exit code. A run that 'finished quietly' with a tiny log and no
> exit code is an OOM kill until proven otherwise. Same for vitest: a reporter that
> 'passed' without running is caught by asserting the test count moved. Record R7 in
> SESSION-STATE and the runbook with tonight's three kills as the reason.

**Tonight's three kills are the reason.** 2026-09-10: three unscoped `pytest tests/`
runs were OOM-killed by the host -- pid 5024, then pid 12872 at **15.9 GB** and pid 33464
at 6.6 GB, the last two found and reported by ANOTHER SESSION whose background work they
took down with them. All three were invisible here, and the same mistake hid each one: the
run was piped to `tail`, so the shell reported TAIL's exit code. A killed pytest behind a
pipe leaves an empty log and a zero exit, which reads first as "still running" and then as
"finished quietly". Two of the three were read that way on the same night.

⭐⭐ **The memory goes on COLLECTION, not execution** (measured by the peer session:
`--collect-only` alone reaches ~4.5 GB), because `api/main.py` is ~9,800 lines mounting
~986 routes and the repo-root `conftest.py` runs an AST census over `api/**`, `scripts/`
and `tools/` at import. So `-k` and `--timeout` cannot contain it -- they filter AFTER
collection. Only giving pytest FEWER FILES does, which is what makes chunking work.

⛔ The runner is `tools/pytest_chunks.py` (committed with this rail -- the repo had SAID
"chunked suite runners" in `pytest.ini` and `tools/tests_reaching.py` for months while no
chunk runner existed; a rule that lives only in prose is one that gets skipped by whoever
has not read the prose). It walks `pytest.ini::testpaths` off the FILESYSTEM rather than
asking pytest to enumerate the suite -- that enumeration is the very thing that blows up --
keeps each chunk's own `returncode`, and reports a chunk with no summary line as **KILLED**
rather than folding it into "0 failed".


---

# ✅ THE MERGE IS LANDED — the collision below is CLOSED (2026-09-09)

`worktree-indicator-ecosystem` merged into `feat/indicator-r0r1` and pushed. The
probe worktree and `merge-probe/r0r1-x-ecosystem` are retired; nothing is left to
replay. Everything from here down is the RECORD of how it was resolved, not work
in flight.

- Merge commit `b91101ae0`, landed fast-forward; branch tip pushed.
- 16 files / 47 hunks resolved. Two defects the auto-merge itself created were
  found and fixed: a second, unreachable barstate dispatch in `pine.js`, and the
  `pine:window-dependent` guard it took with it.
- `tools/record_clock_parity.py` is new — `clock_parity.json` is reproducible now,
  and both prior fixtures turned out to be correct recordings at different forming
  states (mine `false`, theirs `true`). The conflict was serialization noise.
- The NYSE sets moved to `api/services/nyse_calendar.py`, a dependency-free leaf.
  `bars_fetch` and `liveflow_monitor` re-export them; all 55 read sites untouched.
- ⛔ **Items 6–10 are GATED** — see the gate note above the order table.
- ⛔ **Routed to the ecosystem session**, not fixed here: `test_definition_concierge`
  ×2 is red on `35ba654da` itself. Diagnosis in `requests.md`.

---

# ⛔⛔ FIRST THING ON RESUME — the two sessions BOTH implemented barstate

Discovered at the end of the session, after `84a52adf7`. `worktree-indicator-ecosystem`
carries three new commits, one of which is **`ae2ed68ec` "barstate: six columns from the clock
and the fetch, one refusal, two named gaps"**.

⭐⭐ **THE TWO IMPLEMENTATIONS AGREE ON THE RULING, INDEPENDENTLY** — which is the evidence
standard this repo values, and it is worth more than either version alone. Both arrived at:
six clock columns owned by `computeClock` / `compute_clock`; `islast` **not** window-dependent
and `isfirst` **is**; `BUILTIN_REQUEST_DEPENDENT` emptied-but-kept with its reasoning;
`barstate.isnew` refused on both contracts; the host no longer refusing `pine:live-bar-state`;
the screener fold untouched.

## ⚠️ …but the CALENDAR CENSUS disagrees, and they may be right

| | this branch (`cc1171d23`) | theirs (`ae2ed68ec`) |
|---|---|---|
| full closures | `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` | same — agreed |
| **early closes** | **represented** — found `liveflow_monitor._NYSE_EARLY_CLOSES_YYYYMMDD` and used it | **not known** — cites `bars_fetch`'s own words that half-days are *"intentionally NOT"* included; ships regular-session-only with the gap NAMED |
| **extended hours** | assumed regular-session-only, *"an assumption with a test"* | ⛔ **measured that extended-hours bars CAN appear** — `bars_fetch` keeps those prints deliberately and the yfinance fallback asks `prepost=True` |

⛔ **Their extended-hours finding is a measurement and mine was an assumption, so mine is the
one to distrust.** `docs/pine/barstate.md` on this branch asserts *"The bars pipeline delivers
regular-session bars"* — **treat that sentence as unverified until re-measured.** If they are
right, "the regular session was open" is not a precondition any of this may rely on, and the
scheduled-close logic for a daily bar needs revisiting.

⚠️ On early closes we each found something the other did not: they read the `bars_fetch`
comment, I found a second set in `liveflow_monitor`. **Both facts are true** — the half-day
dates exist in the repo, and the bars authority deliberately excludes them. What that means for
`isrealtime` is a decision, not a lookup.

## The merge is deliberately NOT done

`git merge worktree-indicator-ecosystem` conflicts in **16 files**:

```
api/services/indicator_compute.py
app/src/components/chart/indicators.js
app/src/components/chart/engine/ast/closedTable.json
app/src/components/chart/engine/ast/pine.js
app/src/components/chart/engine/ast/pine.barstate.test.js
app/src/components/chart/engine/ast/pineStrictMode.test.js
app/src/components/chart/engine/ast/pine.blindCorpus.test.js
app/src/components/chart/engine/ast/pine.refusalAuthority.test.js
app/src/components/chart/engine/ast/parse.test.js
app/src/components/chart/engine/ast/sentence.test.js
app/src/components/chart/engine/__tests__/clockTimeframeWire.test.js
tests/fixtures/ast/clock_parity.json
tests/fixtures/vendor/divergences.json
tests/test_ast_interpret.py
docs/formulas/GRAMMAR.md
docs/pine/barstate.md
```

Assessed with `merge --no-commit` and then **aborted**, so the tree is clean at `84a52adf7`.
⛔ A half-resolved merge left across a machine restart is the worst possible state; the merge
wants a session that can finish it.

## ✅ RESOLVED 2026-09-09 (post-restart) — the calendar question, settled on evidence

Steps 1 and 2 below are **done**. Measured in the code, not assumed, and it moved **both**
branches.

**Extended hours — theirs is right, mine was wrong, and mine was wrong twice.**
Extended-hours prints **do** reach a fetch, but **only an intraday one**:
`bars_fetch._fetch_intraday_yfinance` asks `prepost=True`, the serve-time filter keeps those
prints on purpose (*"Zero volume is legitimate (illiquid / extended-hours) and is kept"*), and
the freshness gate names 04:00–20:00 ET as the window where *"extended-hours and RTH coexist"*.
**D/W/M do not carry them** — the single `prepost=True` site reads `_YF_CONFIG`, which is
intraday-only, the daily path passes no `prepost`, and `api/index_bars.py` passes `False`.

⛔ **Worse than the wrong premise:** `barstate.md` called it *"an assumption with a test"* and
**there is no such test** — `pine.barstate.test.js` asserts nothing about sessions, hours,
holidays or early closes. A safety net was cited as the reason to accept an assumption and was
never built. Corrected on this branch; the false sentence is gone.

**Consequence is bounded — no number changes.** Intraday `bar_open + interval` is right for a
different reason than the doc gave, and the D/W/M scheduled close survives intact.

**Early closes — MINE is right and THEIR commit message is factually wrong for this repo.**
`ae2ed68ec` ships *"Gap 1 — early closes are not known"*, reasoning from `bars_fetch`'s comment
that half-days are *"intentionally NOT"* in **that** set. True of that set; false of the repo.
`liveflow_monitor._NYSE_EARLY_CLOSES_YYYYMMDD` (line 84) is a real frozenset —
`20250703, 20251128, 20251224, 20261127, 20261224, 20271126` — with **five** consumers
(`flow_gap_autofill`, `voice_temporal_awareness`, `liveflow_monitor` ×2, and the parity test
`tests/test_nyse_calendar_parity.py`), and `indicator_compute.py:1514` already names it the ONE
authority. ⭐ **So their `barstate.test.js` asserts a defect that does not need to exist**, and
their Gap 1 closes outright on merge.

### What the merge should therefore produce — strictly better than either branch

| take | from | why |
|---|---|---|
| intraday reasoning + the extended-hours test | **theirs** | measured; mine reached the same formula from a false premise |
| the early-close set, wired in | **mine** | it exists, has five readers and a parity test — closes their Gap 1 |
| closure set handed in as a parameter (their Gap 2) | **theirs** | correct, and it honours the calendar-must-not-enter-JS rule |
| `barstateStability.test.js`, the `divergences.json` row, the `pine:window-dependent` guard, both rail-tightenings | **mine** | theirs lacks all four |

⛔ **Still NOT merged** — 16 files, and it wants one uninterrupted session. Nothing above has
been applied to the merge; only `barstate.md` on this branch was corrected.

---

## What resume should do, in order

1. ✅ **DONE — do not blind-merge.** Read `ae2ed68ec` in full first. The conflicts are two correct
   implementations of one ruling, not a mistake to be resolved mechanically.
2. ✅ **DONE — settled on evidence; see the RESOLVED block above.** Re-measure whether
   extended-hours bars reach a fetch. That answer decides the scheduled-close logic and it is
   the only place the two versions genuinely disagree about behaviour.
3. Decide which implementation survives — probably theirs for the calendar half, since it was
   measured — and carry over anything this branch has that theirs lacks: the
   **stability tests** (`barstateStability.test.js`), the **`divergences.json` row**, the
   **`pine:window-dependent` guard**, and the **rail-tightenings** (both
   `pineTimeframeAlias` and `clockTimeframeWire` had been deriving "timeframe flag" as
   *clock keys starting with `is`*, a correct set reached by a wrong rule).
4. Then resume the ten-item order at item 4.

---

## Decisions taken autonomously — 2026-09-11

### Item 10's gate is named `VITE_VOLUME_NUMERIC_PANE_ENABLED` and defaults OFF

> ⛔⛔ **IT IS A PLACEMENT FLAG AND IT GATES NOTHING ABOUT PINE RENDERING.** Read
> plainly because the name cost a full re-read of `resolvePlacement` to rule out on
> 2026-09-11: `placement.js::volumeNumericPaneEnabled` decides whether a definition
> **already overlaid on the volume pane** skips the shared LEFT axis and gets its own
> pane and right-hand scale. Turning it on does **nothing whatsoever** for
> `uncharted-volume.pine` — the shared word "volume" is a coincidence. The gate on a
> member's own script reaching a pane is **`VITE_PINE_MEMBER_PANE_ENABLED`**
> (`memberPaneGate.js`, default OFF, scaffolded 2026-09-11 with its flag-off rail).


⚠️ **THE OWNER NEVER SUPPLIED §6's TAIL.** The message was truncated mid-sentence
at *"Feature fl…"*, and the runbook's standing instruction was to ask before
starting M1. The directive of 2026-09-11 overrode that with "ship it behind a
flag, OFF" — so the following are this session's assumptions, stated rather than
hidden:

1. **The name.** `VITE_VOLUME_NUMERIC_PANE_ENABLED`, following the frontend
   convention read off the code (`VITE_*_ENABLED === '1'`, default off, read
   INSIDE a function so a test can flip it — the reason is written down in
   `GlobalVideoLayer.jsx`). ⭐ **Renameable in one line**: it is read in exactly
   one place, `placement.js::volumeNumericPaneEnabled`, and the test derives the
   name from the source rather than typing it.
2. **The behaviour.** "Volume's numeric plots as a pane" is implemented as: a
   definition the user has overlaid onto the volume pane stops landing on that
   pane's SHARED LEFT AXIS — where it is autoscaled by every other overlay and
   has no ladder of its own — and instead falls through to the Flip-C branch that
   gives it a real pane and its own right-hand scale. That is the one behaviour
   the phrase can mean at the seam that owns placement.
3. **The default.** OFF. Turning it on is a member-visible change.

⛔ **AND IT COULD NOT BE DECLARED IN `docs/feature_flags.json`.** That ledger's
gate list is DERIVED by AST from `api/`, `scripts/`, `tools/` only, and
`test_the_ledger_does_not_describe_gates_that_no_longer_exist` **fails on an entry
it cannot derive** — so adding a `VITE_*` row there would break the rail it was
meant to satisfy. Measured 2026-09-11: 115 declared flags, **zero** `VITE_`.
⭐ So `docs/frontend_feature_flags.json` was created as the frontend half, same
shape, same three statuses, with a rail that checks the declaration names a file
that really reads the gate. **The frontend having no gate ledger at all is itself
a finding** and is routed.

### What item 10 does NOT do yet, measured rather than assumed

⚠️ **Volume itself does not reach this pane, because it does not translate in the
pane lane.** Re-measured 2026-09-11 through `translatePine`:

```
SCREENER (default)   ok=true   refusals=4   ta.cum x4 (line 225)
HOST/pane (strict)   ok=false  refusals=1   pine:reassign (line 250)
```

⭐ **That is a big improvement nobody had recorded.** The list in "Volume's
refusal list" above says screener `ok=false` with 5 refusals and pane `ok=false`
with 4 — the three `pine:window` / `isWeekly` refusals at line 233 are GONE (the
other session's bind-time fold landed) and the screener lane has flipped to
`ok=true`. The pane lane is now ONE refusal from translating: `pine:reassign` at
line 250. ⛔ The three-number metric above it ("32/266 host · 46/266 screener —
unmoved") is therefore stale too and should be re-derived before it is quoted.

## Decisions taken autonomously — 2026-09-10

Logged under the autonomous directive of 2026-09-10T12:02:54-04:00. Each is a choice the directive did not
settle; the rails were preserved in every case.

1. **Track B ran in a subagent that was forbidden to commit.** The directive allows a
   subagent but requires one committer and one pusher. Rather than coordinate two writers in
   one worktree, the subagent was scoped to edits + test runs only and this session commits
   everything. Reason: `feedback_agent_authority_and_worktree_isolation` (incident #4).

2. **A1's unbind: two pointer attempts, not three, before the API fallback.** The editor's
   ⋯ menu holds only editor settings / open-editor / developer tools — no new-script action —
   and the script-title control was not resolvable from the DOM among the chart-header
   controls. The directive's own fallback (`createModel` + `setModel`) was taken early
   because it is deterministic. Reason: a third pointer guess is not evidence, and the
   fallback was explicitly sanctioned.

3. **⛔ C / D / E ARE BLOCKED, AND THE BLOCK IS REPORTED RATHER THAN WORKED AROUND.**
   `createModel` + `setModel` swaps the Monaco buffer but the action button still reads
   "Update on chart" — TradingView keeps the binding outside the model. Clicking it would
   write to `Script$USER;787899e2…`, which is the owner's account-scoped script: **hard stop
   H1**. So EXCHANGE, TUPLE and BARSTATE were not added. Their bytes were verified in the
   buffer (EXCHANGE: 8791 chars, sha256 e63b4872…e30f, EXACT) before stopping.

4. **The FOLD study was captured before the binding hazard was understood, and its capture
   stands.** Its bytes were verified byte-identical to the committed source *before* the
   Update, and its roster matched `_metaInfo.plots` order, so the measurement is sound even
   though the add mechanism turned out to be an in-place edit. Job B is committed at
   `e8406af75`.

5. **`UCTPROBE_NS`'s on-chart variant is left absent rather than restored.** Restoring it
   would require another Update against the bound editor — the exact H1 action. It is
   recoverable from `a57b06986`; noted in `UCTPROBE_NS.provenance.json`.

### Item 4 — what landed and what did not (2026-09-10)

| job | state | evidence |
|---|---|---|
| A · Aroon 2c | ✅ **CAPTURED** | `bb486dc36` + `3d845dd94` · `tests/fixtures/vendor/aroon-spy-1d-2026-09-10.json` |
| B · fold numeric half (1g) | ✅ **CAPTURED** | `e8406af75` · 1D `fold==sma20` 400/400 · 1W `fold==sma5` 400/400 |
| C · seven witnesses | ⛔ blocked | bytes verified in the buffer (8791 chars, sha256 `e63b4872…e30f`); study never added |
| D · barstate ×3 | ⛔ blocked | `barstate-full.pine` committed, 26 plots BY SOURCE only |
| E · tuple-security | ⛔ blocked | probe committed, not attempted |
| V1 · NS source | ✅ **COMMITTED VERBATIM** | `a57b06986` · sha256 `2b9fecc6…caa3`, receipt agreed four ways |

⛔⛔ **WHAT BLOCKS C/D/E IS ONE HUMAN ACTION, NOT A DECISION.** The Pine editor is
BOUND to the script whose source was opened, so its action button reads *"Update on
chart"* — which edits that study in place rather than adding a new one. Clicking it
against `Script$USER;787899e2…` would write to the owner's account-scoped script.
Swapping the Monaco model does **not** unbind it (measured: uri changes, button does
not). The unbind is *New indicator* in the editor's script-title dropdown.

⚰️ **THIS SAID "ONCE EACH PROBE IS SAVED UNDER ITS NAME, EVERY FUTURE VISIT IS
`createStudy`-BY-ID WITH NO EDITOR AT ALL". RETIRED 2026-09-11 — it never worked.**
Seven `createStudy` variants were measured and every one refused; the table is in
`capture-procedure.md`. ⭐ **What DOES work, proven on three probes that night:** the
Monaco handle (webpack module scan) writes the buffer with no paste, and the editor's
own **"Add to chart"** button adds it. ⛔ **EVERY ADD BINDS THE EDITOR** — even to an
unsaved "Untitled script" — so the next add must first unbind via the script-title
dropdown → *Create new* → *Indicator*. The button text is the gate and it caught a
real one: after adding `UCTPROBE_GB_HILO` the button read *"Update on chart"*, and
clicking it would have edited that saved script in place.

⭐⭐ **RULING 1g IS SETTLED BY MEASUREMENT.** The vendor folds a timeframe-conditional
length to a plain integer at bind time: `fold == sma20` on 400/400 daily bars and
`fold == sma5` on 400/400 weekly. That is the shape at Uncharted Volume line 233 which
`pine:window` still refuses — so runbook item 1 (wire the bind-time fold into the
translate path) now has its vendor confirmation.
6. **Track B's helper was made PRIVATE (`_session_length_et`) rather than public.**
   Named public it turned `test_scan_evaluator_off_request_path.py` red — a rail requiring
   every PUBLIC function of `scan_evaluator` to be explicitly ruled either "the sweep" or
   "proven free of universe-scale work". Editing that rail's declared list for an internal
   helper would have been a reach ruling taken unilaterally; renaming was the smaller,
   truer change. The module's ruled public surface is byte-for-byte unchanged.

7. **⚰️ `_live_window_reason` DOES NOT EXIST AND NEVER DID.** Three artifacts named it —
   a comment in `scan_evaluator.py`, one in `test_scan_sweep_bar_close_state.py`, and the
   directive that sent this work. The real gate is `_live_session_state`. The two in-repo
   copies were corrected. ⛔ A function name repeated across three artifacts reads as
   corroboration; none of them was checked against the module.

8. **The census floors were routed, not fixed, and the "repopulate the fixture" remedy was
   explicitly closed off.** `tests/fixtures/oos2_parity` contributes 0 scripts *by
   deliberate licence policy* — its `.gitignore` is `*.pine` because six of ten members are
   redistribution-restricted, so all ten are withheld. Counted at the commit that wrote the
   floor, the census was **129** then too: `> 150` has never been satisfiable and this is
   not a regression from the corpus expansion. Both remedies are in `requests.md` with
   their costs and neither is recommended — the census population is their measurement
   decision.

9. **Track C (items 6–10) was NOT started.** Its first task is a producer that wires
   `pineRuntimeFrontend.js` to a member-visible route and retires the L1 gate in the same
   commit. The path is now fully mapped (below), but building it under time pressure at the
   end of a long run is how a member-visible regression (H3) or a weakened rail (H4) gets
   shipped. Mapping it and stopping is the honest state.

### Later the same day — the directive of 2026-09-10 evening (R7 / Rulings A-C / browser)

10. **⛔⛔ RULING C WAS GIVEN TWO BRANCHES AND THE MEASUREMENT FITTED NEITHER.** The directive
    said: if `barssince` serves the Pine lane only, pin `na` semantics and a 1-arg signature;
    if it also serves native features, split it. Both branches presuppose our 2-arg
    declaration is a mis-transcription. The census (R6 control: 712 occurrences / 111 files,
    then narrowed) says it is not — `barssince(condition, n)` is one of the FIVE BOUNDED STATE
    entries and `n` is the WINDOW the count saturates at, the bound the budget is priced on.
    Narrowing to Pine's arity would DELETE that bound. So neither branch was taken; the
    divergence row was written at MEASURED tier as the directive required, and the third
    answer was reported rather than forced into one of the two offered. ⚰️ It also corrects
    `8f1d9836c`, which wrote the obvious reading down on the day of the capture.

11. **A PRE-EXISTING RED WAS FIXED RATHER THAN ROUTED, because the rail was right.**
    `barstate-viewer-dependent-on-vendor` claimed `confidence: measured` while its `measured`
    block was a bare sentence holding no number, so the note-vs-ledger rail had nothing to
    hold the member's sentence against. Proved older than tonight by running the rail against
    the committed tree BEFORE editing. Both halves were repaired, never relaxed: numbers
    DERIVED from the captures, and the member note given the same numbers.

12. **THE `createStudy`-BY-ID HUNT WAS STOPPED AT SEVEN VARIANTS AND WRITTEN DOWN.** Each was
    measured with the roster checked afterwards; the furthest reached
    `_canApplyStudyToParent`. Continuing was the rabbit hole, and switching to the editor
    route at the tail of a mechanism hunt is how the binding hazard (H1) gets tripped. What
    the hunt DID produce is better than what it replaced for one job:
    `pine-facade/translate/<id>/last` gates a saved probe's roster with no chart at all.

13. **Item 7 was advanced by the half that does not need the browser.** All eight questions
    are committed as three probes, split so one risky arity cannot sink the others. Item 8's
    "the readings are now cheap to take" was WITHDRAWN rather than left standing — it rested
    on the by-id add, and items 6, 7 and 8 are now all queued behind that one mechanism.

14. **The JS lane was HELD while the chunked Python lane ran.** Another session's pytest was
    also live on this box at ~1 GB. R7 exists because three unscoped runs OOM-killed the host
    tonight and took a peer session's work down with them; stacking a 220-file vitest run on
    top of two live pytest processes is the same mistake wearing a different runtime.
### ✅ The producer — BUILT 2026-09-10 (`521a52816` + `9dfe101e0`)

The JS seam ALREADY EXISTS and already consumes the tri-state — what is missing is only
something that produces it:

| where | today | needs |
|---|---|---|
| `api/routers/bars.py` | ✅ emits `newest_bar_is_forming` via `_augment_with_bar_close_state` |
| StockChart.jsx bars SWR | ✅ `data?.newest_bar_is_forming ?? null` onto the binder ctx |
| `binder.js` | ✅ `computeFor(..., { sym, tf, newestBarIsForming })` |
| `nativeRegistry` | ✅ both `interpret()` call sites thread it |
| `interpret.js:2777` | already reads `opts.newestBarIsForming` | ✅ nothing to do |
| `indicators.js:1253` `computeClock(bars, tf, newestBarIsForming = null)` | already tri-state | ✅ nothing to do |

⛔ The gate test `pineRuntimeFrontendGate.test.js` is retired in the SAME commit that wires
the route — never before, and never by editing it to keep passing.

⭐⭐ **MEMBER-VISIBLE, AND IT IS AN ADDITION.** `barstate.isrealtime`,
`isconfirmed`, `ishistory` and `islastconfirmedhistory` had rendered BLANK on every
chart since the barstate ruling landed — nothing in `app/src` ever set the value the
column layer was already reading. They now answer. Nothing that worked before stops.

⚠️ **THE WIRE FORMAT NEEDED AN ADAPTER, and its absence would have been silent.**
`bar_close_state` reads `bars[-1]["t"]` in UNIX SECONDS; the daily/weekly wire format
is `"YYYY-MM-DD"`. Without the conversion every daily chart answers `None` — a LEGAL
answer, so nothing complains and the columns stay blank while the producer looks like
it is working and merely cautious. The adapter lives in the ROUTER because the router
is the layer that departed from the clock's contract.

⛔ **THE L1 GATE STILL STANDS, DELIBERATELY.** The producer now exists, which is the
gate's stated precondition — but `pineRuntimeFrontend.js` is still reachable from no
route, and `pineRuntimeFrontendGate.test.js` is still the thing that says so.
Retiring it without wiring would leave the module unreachable AND unguarded, which is
strictly worse. It is retired in the SAME commit that wires the module, and wiring a
new member-facing surface is a product decision, not a mechanical next step.
**Items 6–10 are no longer blocked BY THE PRODUCER** — they concern the engine's
vocabulary, not that route.

---

## ⚠️ Runbook item 1 (the bind-time fold) — STAGE BUILT 2026-09-10, DOOR STILL REFUSES

The runbook calls it *"the single change that clears the largest remaining refusal"* and says
`fold_bound`/`foldBound` are *"built, railed and cross-lane-pinned but not yet called by the
door"*. All of that is true. What it does not say is that **there is no door to call it from.**

Measured, with a positive control on each search:

| fact | evidence |
|---|---|
| `foldBound` (`bind.js:333`) and `fold_bound` (`ast_bind.py:360`) exist | ✅ |
| neither has a single NON-TEST call site | ✅ searched both lanes |
| ⛔ **`bind.js` has ZERO live importers** — the whole module, not just the function | ✅ only tests import it |
| the door refuses at `pine.js:6980` — `resolved.type !== 'num'` → `pine:window` | ✅ |
| ⛔ **`translatePine`'s opts carry NO binding constants** | ✅ read the opts surface |

⭐⭐ **AND THAT LAST ROW IS THE WHOLE PROBLEM, NOT AN OVERSIGHT.** `translatePine` runs at
SAVE time. There is no symbol and no timeframe yet, so it *cannot* fold
`timeframe.isweekly ? 5 : 20` — and `foldBound`'s own header says why that matters: it returns
a new tree and mutates nothing, because **the NEXT symbol folds it differently**, and a pass
that rewrote in place would let the second symbol of a sweep inherit the first's lengths —
"a defect that shows as a WRONG NUMBER, not an error."

⛔ So the refusal at save time is arguably CORRECT, and "call `foldBound` from the door" would
be the exact bug the function was written to avoid. The real question is a design one:

1. **Where does the fold run?** It is per-binding, so it belongs in a bind stage between save
   and compute — a stage `bind.js` was clearly written for and that nothing currently calls.
2. **What does the door emit instead of refusing?** Today a non-literal length is a hard
   `pine:window`. To defer it, the door needs a node the bind stage can later fold, and a
   guarantee that an UNFOLDABLE one still refuses — with the member's own expression named.
3. **What stops a folded tree being saved?** The saved definition must go on meaning what it
   said. Whatever is persisted must be the UNFOLDED tree.

⚠️ `pine:window-dependent` is NOT this mechanism — it refuses values that depend on how much
history was loaded, which is a different question.

⭐ **THE VENDOR HALF IS NOW SETTLED**, which is what changed on 2026-09-10: job B measured that
the vendor really does fold a timeframe-conditional length to a plain integer at bind time
(`fold == sma20` on 400/400 daily bars, `fold == sma5` on 400/400 weekly). So the behaviour is
confirmed and only the placement is open. ⛔ It was NOT attempted here: it is the owner's #1
item, its failure mode is a wrong number rather than an error, and guessing the placement at
the end of a long session is how that ships.

### ✅ The bind stage — BUILT AND WIRED (`a6faf65b7`)

`bind.js` no longer has zero importers. The stage runs inside
`nativeRegistry.astColumnsFor`, keyed on the binding's `(symbol, timeframe)`:

    bindingConstants({ timeframe: timeframeFlags(ctx.tf), inputs, symbol: ctx.sym })
      -> foldBound(tree, consts)   // a NEW tree; the saved one stays symbolic
      -> interpret(bound, …)

⭐ **PROVEN END TO END, not just in the unit:** `computeFor` on ONE definition with
`tf:'D'` and `tf:'W'` produces DIFFERENT columns. Every other assertion in that file
would hold if `foldBound` were perfect and nothing called it — which was the actual
state of this repo. Folded integers are **20 daily / 5 weekly**, which is job B's
measured vendor reading rather than a guess about it.

⭐ `timeframeFlags(tf)` was extracted so ONE derivation decides what `isweekly`
means; `computeClock` now calls it instead of holding its own copy. `null` on an
unknown code, never a default.

⛔ **NEITHER R-a NOR R-c's STOP FIRED.** bind.js still had zero live importers when
the placement was confirmed, and `astColumnsFor` writes nothing back onto `def`, so
no folded tree can reach the save path and no guard had to be invented.

⛔⛔ **BUT LINE 233 IS STILL REFUSED, AND THE RULING PREDICTED IT WOULD NOT BE.**
Measured after wiring, on the real fixture:

    translatePine(uncharted-volume.pine) → pine:window @ line 233
    "a Pine length has to reach the engine as a plain whole number
     — argument 2 of `ta.sma`"

The DOOR refuses at SAVE time, so such a definition never reaches a bind at all.
That is design question **(b)** from the scoping above — *what does the door emit
instead of refusing, so a bind stage can fold it later* — and the ruling settled
where the fold RUNS, not whether the door should ADMIT a bind-time-foldable length.

⚠️ **THE REMAINING DECISION IS ABOUT WHAT GETS SAVED, NOT ABOUT THE FOLD.** Relaxing
the door means a definition whose length is not yet a number becomes persistable,
and the guarantee that has to come with it is that an unfoldable one still refuses
BY NAME at bind time. The stage already does that half (measured: an unknown
timeframe refuses naming the window). What is missing is the door's admission rule,
and R-a explicitly put the fold *not* at the door — so this is a separate ruling.

