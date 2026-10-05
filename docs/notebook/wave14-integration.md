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

## Round 3 (C2 merge, then lane W14-C1 built on the integration branch)

### R3.1 C2 merge (step 1)

| commit | lane | tip merged | conflicts |
|---|---|---|---|
| `9e444bb421` | W14-C2 offer once, What's new, `notebook_tours` merge route, base-tour cold replay | `3435b2289f` | none textual |

C2 was built on a registry holding only the base tour; every C2 rail ran over FAKE registries.
Meeting the real B1-B3 tours:

- **The offer and What's new against the real registry.** New rail
  `onboarding/tourEligibility.realRegistry.test.js` asks the SAME pure rules TourOfferGate and
  Support.jsx ask (`offerableTours`, `pickOffer`, `whatsNewTours`), over the real tours and the
  real flag reader: nothing latched -> nothing offered or new; every tour flag off -> nothing;
  every flag on -> the 19 replayable registered tours in registry order, never the base tour or
  the `note-resurfaces` explainer; one capability on -> only its tours; a seen row stops the
  offer while a "Not now" row (dismissed, step null) stays in What's new. 7/7.
- **One C2 rail broke on the merge**, and it was the fixture, not the product:
  `Support.whatsNew.test.jsx` gave its fake tours the flags of REAL tours
  (`notebook_template_gallery_enabled`, `notebook_ta_fingerprint_enabled`, ...), so with the B
  tracks registered the real Template gallery and fingerprint tours joined its exact lists. The
  fake tours now borrow flags no tour is gated on (voice notes, AI actions, trade canvas).
  Found only by running `src/pages/Support`; the onboarding directory alone was green.
- C2's offer gate stays in NotebookTab (it needs the note-open state and never shows while a
  note is open); the registry gate moved to the app shell in C1 (R3.2). `RegistryToursGate.jsx`
  was not touched by C2, so the move had no C2 conflict.

### R3.2 Lane W14-C1 (engine reach)

Record: `docs/notebook/wave14-w14-c1.md`. Commit `a694fab902` (code, data, rails), then the
docs commit with `tools/notebook_w14c1_mutation_proof.py` and its evidence.

In one paragraph: the registry gate is mounted once in `components/Layout.jsx`; `start` may
be a known page (`START_ROUTES`, railed against `App.jsx`), `{note: 'sample:<key>' | 'recent',
embed?}` or `{trade: 'recent'}`, resolved read-only (`tourStart.js`) with a "nothing to open"
card instead of ever creating data; Next/Back re-check anchors with a bounded wait and a step
may `waitFor` the member's click; `atStart` honours the Notebook's screen parameters; a step in
a sheet (or a waitFor step) is a non-modal card placed in the sheet and Escape closes only the
topmost layer; `replayable:false` is a light once-only explainer triggered by the resurfacing
sheet; three server-only flags are on the payload with their own polarity (task reminders a
kill switch, ON when unset) and their services read through `flag_on`; the always-skipped
thesis-chip step is gone. **20 of 20 registered tours open from Help in the reachability rail.**

The base tour is untouched: `NotebookTour.jsx`, `NotebookTourGate.jsx`, `tourSteps.js`,
`tourCopy.js` and `NotebookTour.module.css` have no diff (the engine's new styles are in its own
lazy `GenericTourEngine.module.css`); `baseTour.zeroDrift.test.jsx` and every `NotebookTour*`
test pass unchanged.

Fixtures that changed with item (g): `Support.notebook.test.jsx` (two Walkthroughs cases) and
`Support.whatsNew.test.jsx` now pin `notebook_task_reminders_enabled: false`, because a payload
that omits it now reads ON and its tour is then listed.

### R3.3 Byte gate

Exactly as `wave14-perf.md`: `npm run build` in `app/`, then
`python tools/notebook_perf_budgets.py --dist app/dist` from the repo root, at `a694fab902`:

```
bytes.notebook_first_open: 2,253,565 B across 66 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
VERDICT: PASS -- within every budget checked
```

Exit 0, 7,228 B under, budget unchanged. Round 2 read 2,247,079 B; C2 plus C1 add 6,486 B
(C2's eager offer gate, about 4.7 KB, and C1's eager remainder: the start fields in the track
files, `START_ROUTES`/`startProblem`/`OTHER_TOURS`, and the gate's slot-drop effect). The new
engine code (`tourStart.js`, `tourLayers.js`, the engine and its stylesheet) is lazy.

### R3.4 Counts (copied)

`npx vitest run src/pages/journal-2-0 src/pages/Support --maxWorkers=2`, `app/dist` built:

- first full run, at `a694fab902`:
  `Test Files  2 failed | 634 passed (636)`, `Tests  9 failed | 8050 passed | 1 skipped (8060)`.
  The nine: `GettingStartedChecklist.test.jsx` (8) and `a11y/gettingStarted.a11y.test.jsx` (1),
  the same cause as the Support fixtures: the W14-D checklist adds a step per armed tour, and a
  payload that omits `notebook_task_reminders_enabled` now reads ON. Fixtures pin it off,
  commit `f16b5cba21`; those files plus ResearchHome: `Tests  103 passed (103)`.
- final full run, at `f16b5cba21`:

```
 Test Files  1 failed | 635 passed (636)
      Tests  1 failed | 8058 passed | 1 skipped (8060)
```

  The one: `lib/iteratorGlobalFloor.test.js` "every built asset is clear",
  `Test timed out in 15000ms` (the load-sensitive case R2 and W14-0 already record). Alone,
  with the app-shell tests: `npx vitest run src/pages/journal-2-0/lib/iteratorGlobalFloor.test.js
  src/components/Layout --maxWorkers=2` -> `Test Files  8 passed (8)`, `Tests  33 passed (33)`.
  Not banked as permitted breakage: a timeout that passes alone.
- Pytest, one run, 21 file patterns (round 2's 17 plus `notebook_tour_seen_state`,
  `note_tasks*`, `document_extraction*`, `note_semantic*`): `1218 passed in 630.30s`, exit 0.
- Mutation proof: control `Tests 91 passed (91)`; 13 of 13 mutations killed (wave14-w14-c1.md
  section 4).
- `python tools/check_repo_hygiene.py`: clean.

### R3.5 Open items

- On deploy, every member whose capability is on is offered (C2) and listed in Help for the
  task-reminders and image/docx tours, and the get-started checklist (when armed) gains a
  task-reminders step: both capabilities are on in production, and (g) makes that visible to
  the client. Correct by C2's rules; a member-facing change to call out before shipping.
- Real-browser walk (W14-Q) still owed; the reachability rail runs against a stand-in app.
- See `wave14-w14-c1.md` section 6 for the lane's own list.

### R3.6 Round 3, continued (2026-10-05): rulings, lane merges, gates

**Rulings applied** (record: `wave14-w14-c1.md` sections 7 and 8):

| commit | what |
|---|---|
| `517e607f14` | one switch on every registry tour (`tourLive`: own flag, `requires`, and `checklistEnabled()`), `requires` on an entry, Help > Walkthroughs hidden while the switch is off |
| `01ed70350f` | its record: flags-off render parity 40/40 against `b06ec4fd85`, 16/16 mutations, counts |
| `4850d64b2e` | the sample's W14-E examples obey the switch, server side (`wave14_switch_on()`, mirrored from the JS rule); switch off writes exactly the pre-wave-14 rows |
| `526b8a43fc` | W14-Q1 S6: an accepted offer is spent only by a tour that opens; template-gallery and meaning-search get a start; every replayable tour must declare one |

**Lane merges** (one merge commit each, in this order):

| commit | lane | tip | conflicts and resolution |
|---|---|---|---|
| `a27892f427` | W14-pb: playbook regime filter, ChartEmbed taps | `9cd699af9c` | none |
| `d402cce939` | W14-ops: restore-drill wrapper, nb_soak | `b124e080ac` | none |
| `660b5c0022` | W14-voice: `request_body_cap` | `0380361586` | none |
| `8f49eaa900` | W14-docs: sample resurfacing kept in the note, BETA-HANDOFF 1c/1d | `5bc372bc5e` | none textual. Resolved in the merge: BETA-HANDOFF 1c said four tours "appear as soon as wave 14 is deployed"; after the ruling they, the offer, What's new and the sample examples wait for `NOTEBOOK_GETTING_STARTED_ENABLED`. C2 recorded as merged; the transcript tour's title and visual-playbook's second flag corrected. |
| `96063e6a83` | W14-Q1: walk and click tools, Help tap floor, What's new fixture | `78b6c9cabe` | `Support.whatsNew.test.jsx`: both sides fixed the same leak of real tours into its fake registry; kept both halves (only the real base entry, and fake tours on flags no real tour uses). |

**Byte gate**, exactly as `wave14-perf.md`, at `526b8a43fc`:

```
bytes.notebook_first_open: 2,254,865 B across 66 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
VERDICT: PASS -- within every budget checked
```

Exit 0, budget unchanged.

**Counts (copied)**, at `526b8a43fc` with `app/dist` built:

- `npx vitest run src/pages/journal-2-0 src/pages/Support --maxWorkers=3`:
  `Test Files  637 passed (637)`, `Tests  8089 passed | 1 skipped (8090)`, exit 0.
- `npx vitest run src/components/Layout --maxWorkers=3`: `Test Files  7 passed (7)`,
  `Tests  24 passed (24)`, exit 0.
- Pytest, one run: flags (`notebook_flags`, `notebook_flag_parse`, `notebook_flag_table_form`,
  `notebook_switch_rehearsal`), ledgers (`feature_flag_ledger`, `flag_ledger_knobs`,
  `visibility_flag_ledger`, `vite_flag_ledger`), sample (`sample_notebook`, `..._examples`,
  `..._trade_exclusion`, `..._switch`), `notebook_tour_seen_state`, `notebook_upload_cap`,
  `notebook_visual_playbook`, `..._regime`, `nb_soak`, `restore_drill_unknowns`,
  `restore_drill_wrapper`, `w13a_walk_shutdown`: `993 passed in 592.75s`, exit 0. Then
  `authdb_restore_drill` + `restore_drill_unknowns`: `21 passed in 3.41s`.
- Flags-off render parity: `40 identical | 0 differ (40 cases)`, `VERDICT: PASS -- identical`.
- Mutation proof: 21 of 21 killed.

**Open items**

- A real-browser re-walk (Q1's tool, now merged) of S6 and the switch-off screens on this tree is
  owed; everything here is measured in jsdom.
- The flags-off parity compares against the wave-13 landing, not master (master does not carry
  wave 13 yet); the merge of wave 13 to master is its own gate.

## Round 4 (2026-10-05): q2, keys and cap2 merged

**Lane merges** (one merge commit each, in this order, all three lanes based on `9004bd8dac`):

| commit | lane | tip | conflicts and resolution |
|---|---|---|---|
| `1e1cc7330a` | W14-Q2: real-browser tour fixes | `c05d2c1e30` | none |
| `eedb40aced` | W14-keys: skip links, roving focus, Ctrl+K "Help: Walkthroughs", focus after base tour | `4a0b9e62be` | none textual. The only file both lanes touched, `tabs/NotebookTab.jsx`, auto-merged into two separate hunks: keys' `GettingStartedSkipLink` first in the skip-link portal, and q2's `data-tour="note-phone-back"` on the phone Back button. Both kept. The other files expected to conflict (`GenericTourEngine.jsx`, `RegistryToursGate.jsx`, `TourOfferPrompt`, `GettingStarted*`, `Support.jsx`) were each changed by only one of the two lanes. |
| `39784a2a52` | W14-cap2: `capped_multipart` on the journal and member upload doors, CSV preview-mapped mapping fix, census row for `PUT /api/j2/onboarding/tours/{tour_id}` | `4d96a7a3d1` | none (server only, no overlap) |

**Counts (copied)**, at `39784a2a52` with `app/dist` built:

- `npx vitest run src/pages/journal-2-0 src/pages/Support --maxWorkers=3`:
  `Test Files  646 passed (646)`, `Tests  8132 passed | 1 skipped (8133)`, exit 0. This run
  includes every q2 rail (`GenericTourEngine.q2`, `RegistryToursGate.remount`,
  `WidgetEmbedView.tourReveal`, the `b1*.steps` tests, `EntryContextCard`, `ReportingSoon`,
  `tourReachability`) and every keys rail under those paths (`a11y/onboardingKeys`,
  `a11y/skipLinkUntappable`, `NotebookTour.keys`, `ResearchHome.welcome`,
  `GettingStartedChecklist`, `TourOfferGate`, `Support.keys`).
- `npx vitest run src/components/Layout src/components/CommandPalette src/hooks/useRovingTabIndex --maxWorkers=2`
  (Layout, plus keys' `Layout.skipLink`, `CommandPalette.walkthroughs` and `useRovingTabIndex` rails):
  `Test Files  11 passed (11)`, `Tests  124 passed (124)`.
- Pytest, one run: `notebook_upload_cap`, `notebook_upload_cap_2`, `upload_cap_member_doors`,
  `notebook_route_security_census`, `notebook_feature_rail_census`,
  `api/services/journal_two/test_csv_import.py`, `test_csv_presets.py`, flags (`notebook_flags`,
  `notebook_flag_parse`, `notebook_flag_table_form`, `notebook_switch_rehearsal`), ledgers
  (`feature_flag_ledger`, `flag_ledger_knobs`, `visibility_flag_ledger`, `vite_flag_ledger`),
  sample (`sample_notebook`, `_examples`, `_switch`, `_trade_exclusion`),
  `notebook_tour_seen_state`, `no_shadowed_definitions`: `1129 passed in 709.39s`, exit 0. The route
  security census red that cap2 recorded as pre-existing at `9004bd8dac` is green here (cap2 added the
  row).

**Byte gate**, exactly as `wave14-perf.md` (`npm run build`, then
`python tools/notebook_perf_budgets.py --dist app/dist`), exit 0, budget unchanged:

```
bytes.notebook_first_open: 2,256,348 B across 67 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
VERDICT: PASS -- within every budget checked
```

**Flags-off render parity** (`tools/notebook_w14_flagsoff_parity.py`; copy in
`evidence/wave14-int-r4/flagsoff-parity.txt`):

```
base b06ec4fd85 vs HEAD 39784a2a52
pass A ['Test Files  1 passed (1)', 'Tests  41 passed (41)']
pass B ['Test Files  1 passed (1)', 'Tests  41 passed (41)']
swapped 48 source files to the base blob; restored, git status unchanged
40 identical | 0 differ (40 cases)
VERDICT: PASS -- identical
```

**Real-browser smoke** on the merged tree (empty sandbox data dirs in the session scratchpad, removed
after; no `bars.db` copied; `C:\data` CLEAN at every checkpoint of all three sandboxes,
`evidence/wave14-int-r4/integrity/`).

Q2 walk, `--only writing-help,template-gallery,image-docx-import,S6`, phases on and off, 1200 and 390
(`evidence/wave14-int-r4/q2-walk.json`, screenshots not kept):

```
TOUR TABLE
  1200 writing-help           opens=True  shown=4/4 skipped=[] axe=True notes=[]
  1200 image-docx-import      opens=True  shown=2/5 skipped=['format:anchor present but has', 'scan:anchor present but has', 'back:anchor present but has'] axe=True notes=[]
  1200 template-gallery       opens=True  shown=4/4 skipped=[] axe=True notes=[]
   390 writing-help           opens=True  shown=4/4 skipped=[] axe=True notes=[]
   390 image-docx-import      opens=True  shown=5/5 skipped=[] axe=True notes=[]
   390 template-gallery       opens=True  shown=4/4 skipped=[] axe=True notes=[]
VERDICT: PASS -- 128 checks
```

image-docx 2/5 at 1200 is q2's recorded design (`wave14-w14-q2.md` R2.2: a desktop has no Scan; the
three phone steps have no box). S6 (offer accept for writing-help and template-gallery, and the
no-notes offer not spent) PASS at both widths. Flags-off control: base tour still auto-starts, no
wave-14 surface on first run, Help, Home or an open note, and no tour chunk fetched, at both widths.

Base tour: Q1's `tools/notebook_w14_onboarding_walk.py --phases on` at 1200/820/390
(`evidence/wave14-int-r4/keys-walk.json`): S1 base tour (auto-start at step 1, no overflow, tap
floor, no stacked surfaces, keyboard reach, axe 0, Escape) and S5 Replay PASS at every width. Its
verdict is FAIL on 9 checks, three per width, none from the merge:

- S4 "Walkthroughs lists ..." and "What's new lists ..." (6): the same instrument staleness keys
  recorded (`wave14-keys.md` section 4; they fail identically in `evidence/wave14-keys/walk/walk.json`).
- S6 "Start the Template gallery tour: a tour opens" (3): q2 made the tour's first step a `waitFor`
  step, which the engine renders NON-modal; this older tool waits only for `[role=dialog][aria-modal=true]`.
  The tour did open: the member's row reads `template-gallery: started, step templates`, and the Q2
  walk (which reads the card itself) shows the same start with the card in view at both widths. The
  tool is left unchanged here.

**Open items**

- `tools/notebook_w14_onboarding_walk.py` needs S4's expected counts derived from the registry and its
  S6 "a tour opens" probe taught the non-modal card (`[data-tour-card]`), as the Q2 walk does. Owned by
  the Q1/keys tools; not a product red.
- The full Q2 walk (all 20 tours, both widths) was not re-run; the subset above is the smoke.
- Flags-off parity still compares against the wave-13 landing, not master.
