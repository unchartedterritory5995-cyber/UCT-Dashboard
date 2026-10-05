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
