# Wave 14 integration (`feat/notebook-w14-int`)

Base: `3c50c50013` (W14-0 tip). Worktree `C:\Users\Patrick\uct-worktrees\notebook-w14-int`.

## 1. Merges (one merge commit per lane)

| commit | lane | tip merged | conflicts |
|---|---|---|---|
| `c1fba0eba6` | W14-A first-run welcome (capability preview, sample promotion) | `d461b3c2bd` | none |
| `62f5145f59` | W14-D getting-started checklist | `82cbbd876f` | textual: none; **semantic: one** (below) |
| `5b2a38b3d9` | W14-E one seeded example per capability | `c83ec7f236` | none (no file overlap with W14-0 since its base `b06ec4fd85`) |

### The one semantic conflict (ResearchHome.jsx)

Git auto-merged both lanes' mount points without a marker:

- A left `const gettingStartedSlot = null // W14-D: ...` rendered in the first-run screen and in
  all three Home returns (four `{gettingStartedSlot}` uses; A's welcome test holds that to one
  assignment and four uses).
- D put `<GettingStartedChecklist ... />` at the end of the `sampleNotice` fragment, which is also
  rendered in all four states.

Left as merged, the checklist mounted through `sampleNotice` and A's slot stayed dead (filling it
later would have mounted the list twice). Resolution, inside the D merge commit: D's element
became the slot's one assignment (still marked `W14-D`) and the copy in `sampleNotice` was removed.
Both lanes' requirements hold: one mount line, rendered on the first-run screen AND every Home
state once the member has notes. Verified by A's two slot rails (one assignment, four uses; M6
of the mutation proof drops one Home return and goes red) and D's
`ResearchHome.checklist.test.jsx` ("on the first-run screen, below the welcome", "still there
once the member has notes"), 6/6.

Placement note: in Home states the list is now the fifth child of the shared fragment (A's
design, so a quiet/full flip never remounts it) instead of inside the quiet-state box.

## 2. Gating ruling: W14-A is not live on merge

Controller ruling: the capability preview and the sample promotion ride the SAME check as the
checklist. `ResearchHome.jsx` computes

```js
const welcomeExtras = checklistEnabled(notebookFlag)   // gettingStartedPref.js, W14-D's helper
```

i.e. `notebook_onboarding_enabled` AND `notebook_getting_started_enabled`, both `=== true`. No new
flag. It gates (a) the lazy `CapabilityPreview` chunk (not requested when off) and (b) the sample
button's `aria-describedby` (off: no attribute, so it never names a promotion that is not on
screen). The sample and tour buttons themselves still ride `onboarding` alone, exactly as before
wave 14.

**Byte-identical with the new flag off, proven against the base, not asserted.** A one-off rail
(not committed) imported `ResearchHome.jsx` from `3c50c50013` beside the integrated one and
compared rendered `innerHTML` across 16 cases (onboarding on/off x paid/unpaid x sample pref
absent/present x first-run/has-notes), every capability flag armed,
`notebook_getting_started_enabled` false: **16 passed**. Control, same rail with the flag true:
**8 failed | 8 passed** (exactly the onboarding-on cases), so the comparison can see a difference.

Durable tests (`ResearchHome.welcome.test.jsx`, new describe "integration gate"):
- onboarding on, getting-started off: today's six doors in order, no preview list, no promotion,
  no "Get started", no `aria-describedby`, and the first-run screen's children are exactly
  `H2, P, DIV`;
- both on: preview list (every line), promotion, `aria-describedby`, and the checklist.
- The existing "onboarding off" test now also arms getting-started, so it proves onboarding alone
  still closes the welcome.
- Every pre-existing welcome test and the `capabilityPreview.a11y` rail now latch both flags.

Mutation proof (`tools/notebook_w14a_mutation_proof.py`, now `--maxWorkers=2`), raw output in
`docs/notebook/evidence/wave14-int/mutation-w14a-gate.txt`: A's seven mutations re-anchored (M1,
M4) plus **M8 the gate removed (`welcomeExtras = onboarding`): KILLED, 1 failed** and **M9
`aria-describedby` ungated: KILLED, 1 failed**. Control `32 passed` before and after, every
restore verified against HEAD, `VERDICT: PASS`.

## 3. Pre-existing pytest reds fixed (W14-0 / wave-13 walk tools)

Both red on `3c50c50013` (the offending lines are in that commit):

- `test_NO_notebook_flag_is_read_outside_the_one_parse` named `tools/notebook_w14_0_walk.py:195`,
  `os.environ["NOTEBOOK_ONBOARDING_ENABLED"] = "1"`: the index reads a subscript as a second parse.
- `test_every_notebook_capability_is_visible_to_the_index[NOTEBOOK_ASK_INSERT_ON]` and
  `[NOTEBOOK_ONBOARDING_ENABLED]`: `tools/notebook_w13q_clicks.py`'s `SANDBOX_FLAGS` dict literal is
  the index's TABLE form, a second declaration site (and it could feed the ledger `"1"` as a
  default); plus the same walk-tool subscript.

The ledger convention for a tool that arms sandbox gates is the w13x walk's: a plain `FLAGS` list
armed with `os.environ.update({name: "1" for name in FLAGS})`. Both tools now follow it; w13q
keeps `SANDBOX_FLAGS` as a derived dict because the wave-13 evidence scripts import it. No rail
changed. Commit `c081b99bc4`.

## 4. W14-E against A's copy and D's step

- A's promotion: "puts example notes in their own folder. You can remove them in one click." E's
  six example notes go to `Sample notebook / Capability examples` (a subfolder of the sample's own
  folder), their ids are folded into the same recorded `ids`, and the same Remove trashes them
  and undoes E's non-note rows. A states no note count, so E's 5 -> 11 notes needs no copy change.
- D's "Open the sample notebook" step ticks on the `notebook_sample` preference. E moves it to
  `v: 2` but keeps `ids`, which is all `readSamplePref` reads. D's "write your own note" step
  skips recorded sample ids, so E's examples cannot tick it falsely.
- Open (copy, not changed here): E also seeds a closed trade into the member's trade log. The
  promotion says "example notes"; a member may find an example trade outside the folder.

## 5. A red the merge introduced, fixed

`doorEnumeration.test.js` rail 5 (server-side note writers outside `journal_two.py` are a
ledger): W14-E's `sample_examples.py` is a new writer with no row. It writes only notes it created
inside the same seed call, and its notes are removed by `sample_notebook.py`'s own pre-checked
trash, so it gets a ledger row and a `NONE` classification with
`tests/test_sample_notebook_examples.py` as evidence. 15/15 after. Commit `0ff7010b93`.

## 6. Test counts (copied)

Vitest, `npx vitest run src/pages/journal-2-0 src/pages/Support --maxWorkers=2`:

- after the merges and the gate, before section 5:
  `Test Files  2 failed | 616 passed (618)`, `Tests  2 failed | 7746 passed | 1 skipped (7749)`.
  The two: `doorEnumeration` (fixed, section 5) and `iteratorGlobalFloor` "every built asset is
  clear", which failed only because this fresh worktree had no `app/dist` ("run `npm run build`");
  after `npm run build`: `Tests  9 passed (9)`.
- final run: see section 8.

Pytest (one run, 14 files: feature_flag_ledger, flag_ledger_knobs, notebook_entry_context,
notebook_entry_context_bell, notebook_flag_parse, notebook_flag_table_form, notebook_flags,
notebook_switch_rehearsal, preference_key_validation, sample_notebook, sample_notebook_examples,
visibility_flag_ledger, vite_flag_ledger, notebook_w13q_clicks): `801 passed`, exit 0.

`python tools/check_repo_hygiene.py`: clean.

## 7. Open items

- **Notebook first-open bytes are over budget, pre-existing.** `tools/notebook_perf_budgets.py`:
  base `3c50c50013` built in a scratch copy reads `2,285,026 B` (+24,233 over the 2,260,793
  budget); this branch reads `2,287,388 B` (+26,595). Wave 14's own cost is **+2,362 B** (the eager
  checklist gate and the slot). Not fixed here; the budget is not raised.
- The trade-in-the-log copy question in section 4.
- Flipping on: one variable, `NOTEBOOK_GETTING_STARTED_ENABLED`, now arms the checklist AND the
  welcome preview and promotion together (onboarding is already armed on web).

## 8. Final run

`npx vitest run src/pages/journal-2-0 src/pages/Support --maxWorkers=2` at `0ff7010b93` (with
`app/dist` built):

```
 Test Files  1 failed | 617 passed (618)
      Tests  1 failed | 7747 passed | 1 skipped (7749)
```

The one: `iteratorGlobalFloor` "every built asset is clear", `Test timed out in 15000ms` on a
shared, loaded box. The same file alone, same tree: `Tests  9 passed (9)` (1.97 s). W14-0's
record (section 5) already lists this exact case among the load-sensitive timeouts. Not banked as
permitted breakage: it is a timeout, and it passes alone.

## Round 2 (perf + B1/B2/B3, the rails, the byte gate, the sample trade)

### R2.1 Merges (one merge commit per lane, in this order)

| commit | lane | tip merged | conflicts and resolution |
|---|---|---|---|
| `b183d69a2f` | W14-perf first-open byte fix | `6c6c1e9a41` | `ResearchHome.jsx` imports and lazy consts: kept A's `useId`, the checklist imports and lazy `CapabilityPreview`; took perf's `importWithOneRetry`, lazy `ReportingSoon`, `loadReviewDrafts` and the `reviewDraftsFlag` import. Every other `reviewDrafts` importer still resolves through the re-export. |
| `7ad9f80da7` | W14-B1 core tours (7) | `80d6896347` | none |
| `3cfc67ed45` | W14-B2 trading tours (6) | `d748cb5eac` | `ResearchHome.jsx`: perf's lazy `(m) => m.draft*()` calls kept, B2's three `review-drafts-*` anchors added on them. `tours/index.js`: both spreads. Both rails: see R2.2. |
| `b49fec4299` | W14-B3 research tours (7) | `7a9c6c0c3c` | `tours/index.js`: spreads in order b1Core, b2Trading, b3Research. `tourRegistry.test.js`: B3's form committed in the merge, reconciled in the next commit. |

### R2.2 The rail reconciliation (`65e4910697`)

The three lanes edited the same two W14-0 rails differently. One version now keeps every lane's
legitimate case and still fails on a real defect:

- **Shape** (`tourRegistry.test.js`): B1 and B2 hard-coded `k !== 'start'`; B3 read the module's
  `OPTIONAL_FIELDS`. Kept B3's (the module is the one authority, the same list
  `assembleRegistry` throws on), and pinned it: a new test asserts `OPTIONAL_FIELDS` is exactly
  `['start']`, so widening it is a visible edit and never a silent way past the shape check. A
  declared `start` must sit under `NOTEBOOK_ROOT`.
- **Replayable** (B3's case): a non-replayable entry must be the 1-2 step passive explainer
  (`note-resurfaces` today, pinned as the non-vacuity case), never a hidden stepper.
- **Orphan anchors** (`tourAnchors.test.js`): B1 accepted any anchor some registered tour names,
  in any file; B2 accepted it only when a step names it IN THAT FILE. Took B2's per-file form
  (strictly stronger; B1's case still passes because B1's own steps name their files), computed
  once at module level for the base tour plus every registered tour. Offenders are now named in
  the failure message.
- **Step budget, new** (plan G2, section 4.2 row 21): a replayable tour has 3-6 steps, a
  `replayable:false` explainer 1-2. The base tour (wave 8, 8 steps, held to zero drift by
  reference equality) is the one exception, by id. Fails listing every offender by name, with
  edge controls (2, 3, 6, 7 for a tour; 0, 2, 3 for an explainer).

Today's registry: 21 entries; 20 budgeted tours of 3-6 steps plus `note-resurfaces` (2 steps,
explainer), plus the base tour.

Mutation proof (each applied by text, the two rail files run, restored by re-applying text, sha
checked):

| # | mutation | result |
|---|---|---|
| M1 | `OPTIONAL_FIELDS = ['start', 'foo']` | 1 failed: "`start` is the ONLY optional field" |
| M2 | stray `data-tour="zzz-stray"` in `NoteEditorPage.jsx` | 1 failed: orphan check |
| M3 | `data-tour="review-drafts-daily"` (declared for `ResearchHome.jsx`) in `NoteEditorPage.jsx` | 1 failed: names `NoteEditorPage.jsx: review-drafts-daily` (B1's form would have passed it) |
| M4 | `data-tour={"x"}` (an expression) in `NoteEditorPage.jsx` | 1 failed: orphan check |
| M5 | `chart-plan-basics` given a 7th step | 1 failed: "chart-plan-basics: 7 steps; a replayable tour must have 3-6" |
| M6 | `passed-setups` cut to 2 steps | 1 failed: step budget |
| M7 | `note-resurfaces` made replayable | 3 failed: explainer pin, non-vacuity, step budget |
| M8 | `passed-setups` made non-replayable | 2 failed: explainer pin, step budget |

Control: `Tests 74 passed (74)` on the two files before and after; every restore `restored=True`.

### R2.3 Byte gate

Exactly as `wave14-perf.md`: `npm run build` in `app/`, then
`python tools/notebook_perf_budgets.py --dist app/dist` from the repo root, at `8778311e0c`:

```
bytes.notebook_first_open: 2,247,079 B across 66 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
VERDICT: PASS -- within every budget checked
```

Exit 0, 13,714 B under, budget unchanged (same reading after the merges and after the sample
change). Perf's own after-reading was 2,240,291 B; the 6,788 B the integration adds over it is
A/D's eager gate and slot plus the registry's eager track lists (each tour's steps and copy stay
behind its `load()`). Nothing needed moving.

### R2.4 The sample trade (W14-E): no longer seeded

**Verdict: exclusion could not be made airtight, so the trade is gone; the example notes stay.**
W14-E seeded a closed AAPL trade through `trades.create_trade_manual` into `j2_trades` with no
sample marker, plus a frozen `j2_entry_context` row. `j2_trades` is read by about 60 modules
under `api/` with raw SQL (analytics, calendar, tax report, the export route, playbook and setup
stats, discipline, overview, books audit, verdict scorecard, excursions, Compass, community, the
public track record, broker reconcile, push, voice tools ...). There is no single read path to
filter a flag at, and every future query would be another place to forget it. Commit
`8778311e0c`:

- `sample_examples.seed` writes no trade, no position and no entry context. The entry-context
  row went too: that table is keyed by (member, symbol, day), so a real AAPL trade on the same
  day would have read the sample's fabricated context and been blocked from freezing its own.
- The trade-plan note stays (chart, drawn entry/stop/target, frozen fingerprint), unlinked; its
  copy now says no trade was added and that linking one of the member's own trades is what
  earns a grade. Being untraded, it also shows on the setups board, which is truthful.
- `remove()` keeps its trade and entry-context branches for a preference written by the earlier
  version (it never shipped; dev boxes only).
- Promotion copy (`capabilityList.js` `sampleTail`): "puts example notes in their own folder,
  plus one example passed setup and one example notice. It adds no trades. You can remove it
  all in one click."

Rails, `tests/test_sample_notebook_trade_exclusion.py` (34 tests):

- **Census**: after a seed, every table holding a row for the member is on a note-side
  allowlist, and no table whose name says trade, position, option, strategy, execution, fill,
  broker, equity, excursion, verdict, plan_grade, entry_context, review, day_note, discipline or
  intervention holds one. Control: a real trade shows up in the census.
- **Per consumer class**, the real read function before and after a seed, compared exactly (only
  `id`, `ts`, `now`, `as_of` and `*_at` keys dropped): trade log, export route (JSON), analytics
  (P&L stats and equity curve), calendar P&L, tax report, overview, playbook stats, setup stats,
  discipline, verdict scorecard, books audit, Compass weekly data, excursions, community trader
  summaries, community shared trades, and the public track record. Control: one real trade
  changes 11 of them (discipline is left out with its reason: one winning trade correctly
  leaves it unchanged).
- **Remove**: no sample note, passed setup or trade left; and a legacy preference naming a real
  trade gets that trade deleted.
- **Book and UCT20**: `modelbook_service.py` and `uct20_nav.py` reference no j2 trade table.
- **Copy**: the promotion says "no trades".

Mutation: re-seeding a trade in `seed()` reds 11 of them (census, 9 consumers, the public track
record, the legacy remove); restore sha-verified.

`test_sample_notebook.py` and `test_sample_notebook_examples.py` were updated to the new
contract (their plan-grading, entry-context and playbook n=1 assertions asserted the
contamination). The ledger prose in `doorEnumeration.test.js` was updated to match. Section 4's
open copy question is closed by this.

### R2.5 Counts (copied)

At `8778311e0c`, `app/dist` built:

- `npx vitest run src/pages/journal-2-0 src/pages/Support --maxWorkers=2`:
  `Test Files  1 failed | 623 passed (624)`, `Tests  7875 passed | 1 skipped (7876)`, exit 1.
  The one file is `a11y/researchCapture.a11y.test.jsx`, which failed to LOAD with
  `Error: ENOSPC: no space left on device, write` (C: was at 98%, 9.5 GB free); no test in it ran
  and no test anywhere failed. Alone, same tree: `Test Files  1 passed (1)`, `Tests  6 passed (6)`.
  Environment, not code.
- `npx vitest run src/pages/journal-2-0/tabs src/pages/journal-2-0/JournalLayout --maxWorkers=2`
  (the JournalLayout tests live beside it; there is no `src/layouts`):
  `Test Files  36 passed (36)`, `Tests  391 passed (391)`, exit 0.
- Pytest, one run of 17 files (section 6's 14 plus `sample_notebook_trade_exclusion`,
  `notebook_perf_budgets`, `notebook_perf_scale_w10`): `882 passed`, exit 0.

### R2.6 Open items

- The machine's C: drive is at 98%; a full vitest run can hit ENOSPC mid-run. Free space before
  the next gate.
- The sample's resurfacing notice is a `voice_proactive_insights` row at importance 8 (Compass
  inbox, Dashboard "Compass noticed"). It is not a trade statistic and Remove dismisses it, but
  it is the one example that surfaces outside the Notebook; worth a look before arming.
- `entry_context.freeze_static` (added by W14-E) now has no caller in the seed; its own tests
  remain. Delete or keep is a W14-E owner call.
- Flipping on is unchanged: `NOTEBOOK_GETTING_STARTED_ENABLED` arms the checklist, preview and
  promotion together; each tour rides its own capability flag.
