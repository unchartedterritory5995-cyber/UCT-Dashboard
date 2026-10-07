# Notebook finish program: the TESTS lane

Branch `feat/notebook-fin-tests`, from the landing tip `5ad9822988`.
This lane changed test files and test fixtures only. No file under `api/` and no non-test file under `app/src` was changed.

It closes two gaps the completeness review found (`R6-COMPLETENESS`, Part 4 and ranked item 13):

- **A.** Seven source files that no test named now each have a focused test file.
- **B.** The frontend tests of the new Notebook surfaces used to type the server's answer by hand. They now load the server's real answers, and a backend test fails when those answers change.

## 1. Defects and mismatches found

None of these is fixed here. Each one is pinned by a test that stays visible: a strict `xfail` in pytest, or `it.fails` in vitest. Both turn red the day the defect is fixed, which is the reminder to remove the marker.

| id | severity | what a member sees | where | pinned by |
|---|---|---|---|---|
| **D2** | IMPORTANT | The Earnings Prep note prints a closed trade's percent result 100 times too small. A trade that made 12.3% is written as "+0.1%". | client `app/src/pages/journal-2-0/lib/earningsPrepShared.js:284` (the formatter is at `:114-119`), server `api/services/journal_two/earnings_prep.py:471` | `it.fails` "D2" in `lib/earningsPrep.test.js` |
| **D1** | IMPORTANT | Thesis chips never appear, and the server logs a 500 every poll, when the chips switch is turned on before the resurfacing lane has ever saved a level. | `api/services/journal_two/thesis_chips.py:108` | strict xfail `test_D1_...` in `tests/test_notebook_contract_fixtures.py` |
| **D5** | IMPORTANT | In Passed setups, a "+5 days" cell can show the six-session return, with no label, when the stored bars have a hole in the middle. | `api/services/journal_two/passed_setups.py:221-246` | strict xfail `test_D5_...` in the same file |
| **D3** | MINOR | A thesis chip with no text (an empty button) for a status named after a built-in object key. | `app/src/pages/journal-2-0/lib/thesisChips.js:59` | `it.fails` "D3" in `lib/thesisChips.test.js` |
| **D4** | MINOR | When sharing a template fails with no sentence from the server, the member reads "request failed (502)" or "Failed to fetch". The plain sentence the form was written with never shows. | `GalleryPublishForm.jsx:30`, `lib/templateGallery.js:74` | `it.fails` "D4" in `GalleryPublishForm.test.jsx` |
| **F2** | MINOR | None directly. The earnings prep draft makes a live vendor lookup that its own backend test does not replace. | `api/services/journal_two/ticker_research.py:48-49`, reached from `earnings_prep.py:451` | the generator's network refusal (see section 3) |

### D2, the client and server mismatch, both shapes side by side

This is the one real shape mismatch the conversion found. It is exactly the class the contract layer exists to catch.

```
server sends   myTrades.value[0] = {"id": "ep-trade", "pnlPercent": 0.123, "rMultiple": 2.46, "result": "Win", ...}
               a FRACTION. The journal stores (exit - entry) / entry
               (api/services/journal_two/calculations.py:36-39) and earnings_prep.py:471 passes it through.

client reads   fmtPct(t.pnlPercent)  ->  "+0.1%"
               lib/earningsPrepShared.js:114-119 prints Math.abs(v).toFixed(1) + "%". It does not multiply by 100.
```

Both unit suites were green because each one typed the value as a percent by hand. The old frontend fixture had `pnlPercent: 12.3`. The backend test seeds `pnl_percent = 12.3` (`tests/test_notebook_earnings_prep.py:241-244`), which is not what the journal stores. The rest of that payload does use percents (`expectedMove.pct: 6.5`, `reactionPct: -3.1`), so the cleanest fix is on the server: multiply at `earnings_prep.py:471`. That is an owner or DATA lane call, not this lane's.

### D1 in one paragraph

`thesis_chips.batch_chips` reads `j2_note_levels`. Only `note_levels.ensure_schema` creates that table, and it runs only when the resurfacing lane projects a note. On a database where that has never happened, every `POST /api/j2/thesis-chips` raises `sqlite3.OperationalError: no such table: j2_note_levels` and answers 500. The client swallows it (`useThesisChips.js` returns `{}` for any non-ok answer), so the member simply never sees a chip. `BETA-HANDOFF.md` says to turn the resurfacing switch on first. Nothing enforces that order. Suggested fix: have the route answer `{}` when the table is missing, or create the table in the journal's own schema.

### D5 in one paragraph

`passed_setups.score()` reads the horizon at position `h - 1` in the name's own stored bars. It labels a gap only when the name has fewer than `h` bars in total. With one session missing in the middle, every later horizon is read one session late. The fixture `passed-setups.add.gap` shows it: the name closes at 200 on the reference day and one point higher each session, and the fifth session is missing from the store. The honest "+5 days" answer is 2.5% or a labelled gap. The server answers 3.0%, which is the sixth session. The backend test covers only a store that stops early, not a hole.

### Two rails that are red on the base, not caused by this lane

Both were checked against the base commit with `git cat-file blob 5ad9822988:<path>`.

- `app/src/__tests__/sourcesAreText.test.js` is red for two control bytes in `app/src/pages/terminal/L0Strip.test.jsx:105`. The bytes are in the base blob.
- `app/src/components/screener/reachable.test.js` is red for a parking note that expired on 2026-10-06. That is a date check, and the date has passed.

## 2. Part A: the seven files no test named

Each file below was mutation checked. The unit was broken one way at a time, the test file was run and seen red, and the unit's captured bytes were written back. `git status` showed no product file changed afterwards. 25 breaks in all, all red.

| source file | test file | tests | what it pins |
|---|---|---|---|
| `components/notebook/GalleryPublishForm.jsx` | `GalleryPublishForm.test.jsx` | 22 | What the form tells the member is shared and left out. Submit is disabled until a category is picked and for a blank title. The four fields sent are the four the server reads. The success sentence uses the title the server stored. For each refusal (bad category, blank title, free plan, template gone) the alert shows the server's own sentence, what was typed is kept, and Submit works again. A second submit while one is out sends nothing. |
| `components/notebook/onboarding/tourLayers.js` | `tourLayers.test.js` | 24 | A tour card yields Escape to a sheet or modal opened after it, and only to those. It does not yield to a layer it sits inside, a layer inside it, or a non-modal dialog. Null, text nodes and plain objects do not throw. |
| `hooks/usePlanGrade.js` | `usePlanGrade.test.jsx` | 36 | Nothing is fetched with the switch off. A failed read is an error with its status, never an empty grade and never "unplanned". Re-link shows the server's sentence when refused and shows the new grade without a second read. More than 200 trades are asked for in batches and none is dropped. One failed batch fails the whole read. |
| `hooks/useEntryContext.js` | `useEntryContext.test.jsx` | 25 | "Nothing was captured" is data with the server's reason, not an error. A free plan (402) is not an error either. Every other failure is an error, never an empty context. Saving the why note sends exactly the recorded request and shows the server's sentence when refused. |
| `lib/myPlaybookLink.js` | `myPlaybookLink.test.js` | 14 | The switch is on only for a real `true`. The path is a route `App.jsx` registers and it mounts My Playbook. The Insights door links to the constant, not a second literal. |
| `lib/planGradeText.js` | `planGradeText.test.js` | 37 | Prices at every size, zero, negative, very large, and every wrong type show a dash, never "NaN". The four checks of the server's real grade are worded exactly. The size delta is read as a fraction (0.5 is 50%). A broker trade with a placeholder stop (stop equals entry) is graded on the plan's stop and says so. Every label and match tier the server sends has words. |
| `lib/thesisChips.js` | `thesisChips.test.js` | 33 | The four statuses, labels and colors equal the server's own table. The distance to the stop is a percent of the current price with the right sign on both sides of the stop, and exactly on it. A missing stop or price falls back to the status. The chip is never blank (except D3). |

The mutations, for the record:

| unit | breaks, each seen red |
|---|---|
| `planGradeText.js` | the fraction printed without the multiply; the price precision judged by sign |
| `thesisChips.js` | the distance divided by the stop; one status color changed |
| `myPlaybookLink.js` | the switch read as "not false"; the path changed |
| `tourLayers.js` | the document order test reversed; the host selector narrowed |
| `usePlanGrade.js` | a failed read returned as `{}`; the batching removed; a second read after Re-link; the server's sentence dropped; a partial batch allowed |
| `useEntryContext.js` | the free-plan status changed; the error hidden; the why sentence dropped; id 0 treated as no id; a failed read returned as `{}` |
| `GalleryPublishForm.jsx` | the error hidden; the typed title used; the disabled rule removed; the double-submit guard removed; the blank-title guard removed; Submit left stuck after a failure |

## 3. Part B: the contract layer

### How it works

`tools/notebook_contract_fixtures.py` builds one FastAPI app carrying every wave 12 to 15 Notebook router and asks it, in process with the TestClient, for its real answers. It writes them to `app/src/pages/journal-2-0/__fixtures__/contract/<name>.json`. There are 161 files. Each is `{"_contract": {endpoint, case, status, path, requestBody}, "body": <the answer>}`.

- It imports the repo-root `conftest` first. That applies the census pins and arms the shared-root tripwire, so nothing can reach `C:\data`. The run fails if the tripwire recorded anything.
- It uses a fresh temporary `auth.db` for each run.
- The clock is frozen at Monday 2026-10-05 10:30 in New York. Ids come from a seeded counter. Two runs are byte identical.
- Outbound connections are refused and recorded. A vendor call nobody replaced fails the run. That is how F2 was found.
- Outside sources (prices, the earnings calendar, the regime, the screener store, Compass sizing) are replaced by fixed stand-ins, the same way the backend tests do it. The fixtures pin the shape and the composition the server emits. They do not pin a live market value.
- Drawings are recorded in the shape the client writes: the level is the line's own anchor, with no separate price copy.

`tests/test_notebook_contract_fixtures.py` regenerates in memory and fails when a committed file differs. It names each file that moved and the first line that changed.

To regenerate after an intended server change:

```
python tools/notebook_contract_fixtures.py            # write
python tools/notebook_contract_fixtures.py --check    # compare only
```

Then run the frontend tests that load the changed files. A red frontend test at that point is a real difference between what the server sends and what the client reads. Report both shapes. Do not edit the fixture or the component to make it pass.

`app/src/pages/journal-2-0/__fixtures__/contract.js` is the one loader the frontend tests use. An unknown fixture name throws, so a typo can never read as "the server sent nothing".

### What the pytest pins

| test | pins |
|---|---|
| `test_the_committed_fixtures_are_what_the_server_answers_today` | every committed file equals a fresh run |
| `test_two_runs_are_byte_identical` | the frozen clock and seeded ids hold |
| `test_every_fixture_is_in_the_generators_own_form` | no file was edited by hand |
| `test_CONTROL_a_server_shape_change_is_caught_and_named` | one key renamed on the setups board turns exactly the board's successful answers red |
| `test_CONTROL_a_changed_sentence_is_caught` | one error sentence changed turns exactly that fixture red |
| `test_CONTROL_missing_and_extra_files_are_named_not_counted` | the comparison reports names |
| `test_every_route_has_a_pinned_answer_and_both_sweeps` | every route on those routers (46, read from the routers) has a successful answer, a 401 signed out, and a 404 with the flags off |
| `test_every_error_the_client_can_be_handed_carries_a_detail` | every error has a sentence, except the four that carry FastAPI's own list |
| `test_the_generator_runs_on_a_temporary_database_and_refuses_the_network` | the network refusal can fire |

### Fixtures by surface

| surface | files | covers |
|---|---|---|
| plan grades | 19 | a graded trade, an unplanned one, a tie, a drawn plan with a setup tag, a placeholder stop, each Re-link answer and refusal, statuses, the discipline record empty and with thirty trades |
| entry context | 18 | captured, captured late, with labelled gaps, not captured, no entry day, the why note saved and refused, the list, the backfill |
| chart plan | 12 | sized by Compass, by the starter formulas, with the default account, with no levels, alerts armed and refused, benchmarks |
| visual playbook | 14 | the grid, a filter, a range that leaves charts out, a thin slice, the regime frozen and not available, before and after |
| setups board | 4 | one card in each state, forty setups, empty |
| My Playbook | 3 | three sample bands and two patterns, empty |
| earnings prep | 7 | the week, an empty week, a full draft, a draft with every source missing, the daily limit |
| passed setups | 15 | scored, pending, a short store, no bars, a traded name, add and remove, each refusal |
| review drafts | 10 | daily, weekly, monthly, each empty, each refusal |
| template gallery | 33 | browse, the full template, submit and its refusals, submissions in every status, use, report, the review queue with one of each kind, each admin action |
| thesis chips | 5 | chips with and without levels, empty, each refusal |
| find similar, transcripts, fingerprint | 17 | the refusals and empty states (see "Not covered") |
| sweeps, shared tables | 4 | every route signed out (401) and with flags off (404); the thesis status options and gallery categories |

### The twelve test files converted, for the ten surfaces

Each of these used to build its own response objects by hand. Each now loads the contract fixtures. A mutation of the component was run against nine of them after conversion, and each went red.

| surface | test file | tests before | tests after |
|---|---|---|---|
| plan grading card | `components/trade/PlanGradeCard.test.jsx` | 9 | 13 |
| Discipline tab | `components/insights/DisciplineRecord.test.jsx` | 4 | 10 |
| entry context card | `components/EntryContextCard.test.jsx` | 9 | 10 |
| chart plan panel | `components/notebook/ChartPlanPanel.test.jsx` | 15 | 18 |
| visual playbook | `components/notebook/VisualPlaybook.test.jsx` | 15 | 19 |
| setups board | `components/notebook/SetupsBoard.test.jsx` | 5 | 9 |
| My Playbook | `components/insights/MyPlaybook.test.jsx` | 9 | 13 |
| earnings prep (list) | `components/notebook/ReportingSoon.test.jsx` | 8 | 9 |
| earnings prep (note) | `lib/earningsPrep.test.js` | 10 | 14 |
| passed setups | `components/notebook/PassedSetups.test.jsx` | 5 | 11 |
| review drafts | `lib/reviewDrafts.test.js` | 24 | 31 |
| template gallery | `components/notebook/TemplateGallery.test.jsx` | 10 | 12 |

Most of the added tests are states the hand-typed versions never had: the empty state and the failed read for each surface, shown as different things.

### Where a hand-typed value remains, and why

These are stated in the test files too.

- **Routes older than this wave.** `/api/j2/notes`, `/api/j2/note-templates`, `/api/watchlist-alerts`, `/api/bars` and the research summary keep small stand-ins. They are outside the contract.
- **Find similar matches** (`SetupsBoard.test.jsx`). The route only reads rows the nightly job stored. The generator does not fabricate one, so the matches answer is still typed by hand.
- **One Compass quote** (`reviewDrafts.test.js`). The recorded member has no stored Compass review. One three-field override adds it.
- **Single scalar overrides** on a real answer, each with a comment: an options count in the discipline record, a cleared account size in the chart plan panel, two source labels in passed setups, a placeholder stop in the earnings prep note.

## 4. Not covered

- **No successful answer is recorded** for four routes, each named in `NO_SUCCESS_RECORDED` in the pytest with its reason: find-similar matches, reading a transcript, saving a transcript passage, and freezing a fingerprint. Each needs a stored vendor artefact. Their refusals and both sweeps are recorded.
- **Rate limits.** The gallery's hourly publish and report limits are not recorded. The earnings prep daily limit is.
- **The other hand-mocked test files.** The review counted 23. Twelve are converted. Not converted: the a11y files, `HoldingsList.thesisChip.test.jsx`, `ThesisChip.test.jsx`, `useThesisChips.test.js`, `TradesTable.planGrade.test.jsx`, `WhyPrompt*.test.jsx`, `PlaybookSection.test.jsx`, `TemplatePicker.gallery*.test.jsx`, `ChartPlanPanel.*.test.jsx` (three), `WidgetEmbedView.chartPlan.test.jsx`, `SlashMenu.chartPlan.test.jsx`. The fixtures they would need already exist.
- **The ranked items 20 to 24** of the completeness review were read and are not test work this lane could close: the orphan `entry_context.freeze_static` (20) and the thesis chips explainer (21) are product decisions, the citation cells (23) are research, and the plan-matching question about `earnings-prep` notes (24) was not measured. Item 22 (the wording-parity rail skips when Node is missing) was not changed.
- **No browser.** Everything here is jsdom and the in-process server.
- **`npm run build` was not run**, as instructed.

## 5. How to run

```
python -m pytest tests/test_notebook_contract_fixtures.py -q            # 9 passed, 2 xfailed

cd app
npx vitest run src/pages/journal-2-0/components/notebook/GalleryPublishForm.test.jsx \
  src/pages/journal-2-0/components/notebook/onboarding/tourLayers.test.js \
  src/pages/journal-2-0/hooks/usePlanGrade.test.jsx src/pages/journal-2-0/hooks/useEntryContext.test.jsx \
  src/pages/journal-2-0/lib/myPlaybookLink.test.js src/pages/journal-2-0/lib/planGradeText.test.js \
  src/pages/journal-2-0/lib/thesisChips.test.js \
  src/pages/journal-2-0/components/trade/PlanGradeCard.test.jsx \
  src/pages/journal-2-0/components/insights/DisciplineRecord.test.jsx \
  src/pages/journal-2-0/components/EntryContextCard.test.jsx \
  src/pages/journal-2-0/components/notebook/ChartPlanPanel.test.jsx \
  src/pages/journal-2-0/components/notebook/VisualPlaybook.test.jsx \
  src/pages/journal-2-0/components/notebook/SetupsBoard.test.jsx \
  src/pages/journal-2-0/components/insights/MyPlaybook.test.jsx \
  src/pages/journal-2-0/components/notebook/ReportingSoon.test.jsx \
  src/pages/journal-2-0/lib/earningsPrep.test.js \
  src/pages/journal-2-0/components/notebook/PassedSetups.test.jsx \
  src/pages/journal-2-0/lib/reviewDrafts.test.js \
  src/pages/journal-2-0/components/notebook/TemplateGallery.test.jsx --maxWorkers=2
# Test Files 19 passed (19) / Tests 360 passed (360)
```
