# Notebook landing, waves 12 to 15

Final record, written by the landing lane on 2026-10-07.

- Branch: `feat/notebook-w14-land`.
- Gated tree: `ef3fcccd19`. Commits after it change documents and evidence only.
- Master merged in: `18676e3ece` (ninth master merge, `3571134832`).
- Pull request: #281, opened by the controller.
- Size against master: 4,609 files: 80 under `api/`, 607 under `app/src/`,
  72 under `tests/`, 3,788 under `docs/` (committed evidence).
- Not done by this lane: opening the pull request, merging, any deploy, any Railway variable.

Sections 1 to 10 are true at the gated tree. The appendix is the working record of how the
branch was built; each appendix section is true at the commit it names.

## 1. What lands

| Wave | What it is | Reaches members on merge? |
|---|---|---|
| 12 | Community template gallery: publish a copy of one of your templates, browse, copy, report | No. `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` |
| 13 | Trading and research features: plan grading, My Playbook, earnings prep, resurfacing, entry context, review drafts, passed setups, transcript capture, thesis chips, chart plan, technical fingerprint, visual playbook, find similar, setups board | No. One switch each, section 3 |
| 14 | Onboarding: get-started checklist, sample notebook, tours registry, tour offer, What's new, keyboard doors | No. Needs `NOTEBOOK_ONBOARDING_ENABLED` and `NOTEBOOK_GETTING_STARTED_ENABLED` both on |
| 15 | Evidence: parity scorecard re-score, walks, gate records | Documents and tools only |
| Finish program | Fixes from the review lanes (security, data, frontend, accessibility, navigation, voice and request bodies, keyboard), their tests, and the rollback kit | Partly. Section 2 lists what is live |

## 2. What is live on merge, with no switch touched

Each item comes from the diff or from the lane record named beside it. The confirmation walk
(section 6) covered most of them in a browser; this lane walked none itself.

**Defects that are live in production today, fixed by this merge**

- "Read me the morning briefing" and the closing briefing played nothing in a voice session.
  They play now (`fin-voice.md` section 1).
- The Voice Telemetry tile in Settings showed no cost figures, because its request answered
  500. It shows them now (`fin-voice.md` section 4).
- Five screens scrolled sideways on a phone: the research workspace header, the closed trades
  toolbar, the trade page header, the Help header, and the Why prompt's Edit control. They fit
  now (`fin-a11y.md` section 5b).
- A saved view's Delete did nothing on Research Home or beside an open note. The confirm was
  drawn only inside the notes list. It opens everywhere now (`eeccbdf6a2`, `fin-fe2.md`).
- A brand-new member's first page could answer an error: two first requests at once both
  tried to create the default account, and one answered 500. One creates it and the other
  reads it now (`cd3f62ef9f`, `fin-data.md`).
- A Notebook Delete confirm could sit under the voice orb, which took the tap. The confirm
  locks the page behind it now and is on top (`fin-fe2.md` P1).
- Public share links and published pages kept unsafe formatting from the stored note: unknown
  attributes, a font value that was not a font name, a link's stored class and title. They are
  stripped now, on the server and in the editor (`fin-sec.md` rounds 2 and 3).
- 93 Journal, Notebook and voice requests read their body before checking the sign-in, and
  with no size limit. Each now passes its gates first (switch, sign-in, paid plan, rate limit)
  and then reads a body with a size limit. What a client can see: a request with no session
  is refused 401 where it used to answer 422, and a body over its limit is refused 413 where
  it used to be accepted. Nothing else changed in 2,811 compared requests (section 5).
- In the CSV import dialog the column mapping the member chose was not applied. It is now.
- A click on a chart or image block in a note did not select the block. It does again,
  except in Draw mode.
- The basics tour could trap the Back button and replay on reload. It no longer does. A tour
  that cannot start closes and says so. A tour's step counter counts the steps it shows.

**Uploads and imports**

- An upload over its size limit is refused at once with a plain sentence, instead of being
  read whole first. The limits did not change. During a note import the summary shows that
  sentence instead of "Upload failed (HTTP 413)".
- A large note import is sent in pieces by size as well as by count.
- Unpublishing your own shared content needs a sign-in only, never a paid plan.

**Keyboard and screen reader**

- After moving between Journal pages, keyboard focus lands on the new page and its name is
  read once. The next Tab is the page's first control.
- The note editor's formatting toolbar, and a chart block's toolbar, are each one Tab stop.
  Arrow keys move inside them.
- The pop-up menu shared across the app (`components/mobile/ContextPopover.jsx`) holds real
  menu items with a menu's arrow keys. A pop-up that holds custom content is a named dialog.
  This component is used outside the Notebook too, for example by the Terminal.
- The command palette's "Search Notebook" opens search with the cursor in the box.
- Screener: a "Skip to save results" link is the second Tab stop, so "Save these results to
  Notebook" is a few presses away instead of hundreds.
- The Journal's top tab bar is never briefly out of the Tab order.
- New keys: Ctrl+Alt+B for bulk actions, Shift+Arrow to extend a selection in the notes list.
  Skip links on the always-on Notebook pages.
- Touch targets in the Notebook are at least 44 px wide as well as tall, with the three
  exceptions in section 6.
- The other accessibility changes on always-on surfaces are listed in `fin-a11y.md`.

**Notebook and Journal pages**

- Eight more built-in note templates, and a "Today" button on Research Home.
- Picking the Trade Plan template creates its property definitions once. Existing rows are
  unchanged.
- On a chart block at 1024 px and under, the block toolbar is always shown and there is a
  "Block actions" button (Move up, Move down, Remove).
- Insights > Playbook numbers changed: the untagged count, the sample-size wording and the
  drill rows.
- Five dialogs load on first use (Portfolio settings, New account, Generate report, Add
  position, Add trade). There is a short pause the first time each opens.
- A chart block whose drawings carry plan roles gets a plan line in note exports. Creating
  such drawings needs the dark chart-plan switch.

**Nothing visible, but it happens at boot or on every request**

- Thirteen new tables and two new columns are created at boot (additive, idempotent). The
  firm's gallery templates are seeded once.
- The server accepts the new note node types. See rollback, section 9.
- Nineteen new Notebook member routes require a paid plan. All of them sit behind dark
  switches, so no member reaches them yet.
- Three existing switches are read through one parser. Same answer for every spelling.

## 3. What stays dark

All sixteen new switches are read per request on `web`, ride the sign-in payload, default OFF
(unset means off) and are declared `dark` in `docs/feature_flags.json`.

| Switch | Wave | Turns on |
|---|---|---|
| `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` | 12 | Community template gallery |
| `NOTEBOOK_PLAN_GRADING_ENABLED` | 13A | Plan versus execution grading |
| `NOTEBOOK_PLAYBOOK_ENABLED` | 13B | My Playbook page |
| `NOTEBOOK_EARNINGS_PREP_ENABLED` | 13C | Reporting soon and earnings prep notes |
| `AWARENESS_NOTE_RESURFACE_ENABLED` | 13D | Notes resurfacing through the Awareness Engine |
| `NOTEBOOK_ENTRY_CONTEXT_ENABLED` | 13E | Market context frozen at the fill |
| `NOTEBOOK_REVIEW_DRAFTS_ENABLED` | 13F | One-click daily, weekly, monthly review drafts |
| `NOTEBOOK_PASSED_SETUPS_ENABLED` | 13G | Passed-setups journal |
| `NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED` | 13G | Save a transcript passage into a note |
| `NOTEBOOK_THESIS_CHIPS_ENABLED` | 13G | Thesis chip on a position row |
| `NOTEBOOK_CHART_PLAN_ENABLED` | 13H | Chart plan in notes |
| `NOTEBOOK_TA_FINGERPRINT_ENABLED` | 13I | Technical fingerprint and chart-block index |
| `NOTEBOOK_VISUAL_PLAYBOOK_ENABLED` | 13I | Visual playbook grid |
| `NOTEBOOK_FIND_SIMILAR_ENABLED` | 13J | Find more like this |
| `NOTEBOOK_SETUPS_BOARD_ENABLED` | 13J | Active setups board |
| `NOTEBOOK_GETTING_STARTED_ENABLED` | 14 | Get-started checklist. Wave 14 needs this AND the existing `NOTEBOOK_ONBOARDING_ENABLED` |

Caps that are settings, not switches: `NOTEBOOK_GALLERY_PUBLISH_DAILY_CAP`,
`NOTEBOOK_GALLERY_REPORT_DAILY_CAP`, `NOTEBOOK_EARNINGS_PREP_DAILY_CAP`.

**Arming order, and which switch depends on which: `docs/notebook/BETA-HANDOFF.md`, section 1d
(the overall order), with sections 1b and 1c for waves 13 and 14.**

Three existing ledger entries changed their text only (`NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED`,
`NOTEBOOK_SEMANTIC_SEARCH_ENABLED`, `NOTEBOOK_TASK_REMINDERS_ENABLED`). Their live values are
untouched.

## 4. What restarts on merge

**Merge outside market hours.**

- `flow-worker` restarts. The landing bumps `api/flow_worker_deploy_marker.txt` (bump 11), a
  file on flow-worker's watch list. It is bumped on purpose: fifteen
  `api/services/journal_two/` files that flow-worker runs but does not watch ride along with it
  (`python tools/flow_worker_watch_coverage.py`: OK, 15). While flow-worker restarts, the
  options tape drops, and the vendor does not replay what was missed. That gap stays until the
  next day's flat file.
- `web` restarts, as on every merge. `/api/*` is unavailable for a minute or two.
- The landing changes files under `api/`, so the services that watch `api/**` restart too
  (`worker`, `bars-api`, per `docs/runbooks/deploy-windows.md`). This lane did not read the
  Railway dashboard, which is the authority on watch paths.
- Open browser tabs keep the old bundle until they reload.

## 5. The gate, and the other checks

**Front-end gate: none of the failures is caused by this landing.** Four six-shard runs. The
one that counts is run 4, on `ef3fcccd19`: tree identical at both ends, 2,991 test files on disk
and 2,991 run, **13 failed, 41,606 passed, 41,731 tests**. Twelve fail on master `18676e3ece`
with the same message, run file by file in a separate worktree. One
(`ScanObjectCard.test.jsx`, master's file) is load and passes alone. Manifest:
`docs/notebook/gate-runs/landing-12-15/final/2026-10-07T20-47-06.md`. Classification, with all
four runs: `final/classification.md`.

- Run 1 found nine rows this landing did cause, in seven files, plus one hidden in a test
  master already has red. All were fixed at the cause in `9a83a9df12` (appendix section 15).
- The wrapper exits 1 on every run because the committed baseline is from 2026-09-24 and 124 of
  its 126 rows no longer fail, so master's newer failures read as NEW. The baseline was not
  rewritten.
- One landing test failed once under load in run 3 (`ChartPlanPanel.asOfDay.test.jsx`). It is
  not the hour: the replay gives the same answer at 14 faked instants. The matrix is filed as a
  patch for the follow-up, not landed (`final/classification.md`).

**Carry-over (controller ruling, 2026-10-07 21:55 CT).** The branch head has no difference from
`ef3fcccd19` under `app`, `api`, `tests`, `tools` or `scripts`, so the tool answers CARRIES for
it (C0 identical). Master moved again after the gate (to `30f564d4e6` when measured here, and
further since); those commits share no file with this branch and a trial merge is clean. They
are not merged and not gated: a gate takes 65 minutes and master moved about once an hour. The
tool's import-graph check (C2) cannot be evaluated, because nothing in the repository produces
the graph. That is recorded as an accepted risk, backed by the post-deploy smoke.

**Python, on the final tree (`213850e1fa`), named files in 17 chunks, bundle moved aside.**

| What | Result |
|---|---|
| 405 named files: every Notebook, Journal, voice, awareness and landing rail run in phases 1 to 10, the Journal's own test folder, `PY_RAIL_FLOOR`, and the carry-over tool's own list | **10,294 passed, 25 failed, 2 skipped** |
| of the 25: `tests/test_gate_shards.py`, 10 tests | Fail only in company (another file in the chunk claims the module name `scripts`). The five floor files alone: 287 passed, 1 failed, 2 skipped, the same on master |
| of the 25: the rollback rehearsal probe, 3 tests | Not a rail on this tree. It needs the rehearsal's own settings and is run by `rehearse.sh` on the reverted trees |
| of the 25: the remaining 12 | Fail on master `18676e3ece` too: the same set, run there by name. Listed in section 7 |
| Body order, census, router order, voice shapes, contract fixture rail, whitelist, with the bundle mounted | 123 passed |

**Other checks at the gated tree.**

| Check | Result |
|---|---|
| `npm run build` | exit 0 |
| First-open bytes | `2,218,478 B across 57 JS chunks`, PASS (42,315 B under the 2,260,793 B budget) |
| Flags-off parity, against the wave-13 landing `b06ec4fd85` | 28 identical, 12 differ only by a named expected difference, 0 differ. PASS. Five differences are named; four need their own switch on, and one is always on (the editor toolbar as one Tab stop) |
| Request-body differential | `93 routes, 2811 requests: 2640 same, 171 intended, 0 REGRESSIONS` |
| Contract fixtures | 182 match the server |
| Deletion manifest, nav manifest, hub matrix, parity scorecard, hygiene | match, 0, 0, VERIFY: PASS, clean |
| `grep -c broker_sync api/main.py` | 10 |
| Rollback rehearsal (appendix sections 11, 12) | Reverting with the keep-list keeps plan data and leaves 0 rows behind on account deletion. A plain revert loses both |

**CI on this branch, latest run of each workflow.** Notebook accessibility: success at
`3ef91f83f9` (no Journal file changed since). notebook latency, with write protection: success
at `b79e1c30cf` (no `journal_two` file changed since). flow-worker deploy coverage: success at
`f3be943a97`. notebook bytes, notebook budgets, vite build args, wisdom rails, term018 guards:
success at `ef3fcccd19`. The path-filtered workflows do not run on a push that does not touch
their paths. The `master deploy gate` does not run on branches.

## 6. The confirmation walk

Record: `docs/notebook/fin-walk.md` (lane WALK, run on landing tip `af0b7ffeea`, merged here as
`f320a28a3f`). **Verdict: no blocking product failure.** Three items are left for the follow-up
pull request:

- **F1.** The "Skip to folder navigation" link has no target. Two of the three skip links
  work.
- **F2.** Three touch controls are under 44 px: the "All" filter (38 by 44), one checkbox
  (20 by 20), and the import wizard's destination row (37 px).
- **F3.** Dragging a chart block with the mouse was not proven by the walk's synthetic
  pointer. The frontend lane's own browser run recorded it working at 1280 px
  (`fin-fe.md`, the selection walk).

What the walk says it did not cover is in its sections 5 and 6, and in section 8 below.

## 7. Reds this landing carries, by owning area

Notebook-owned: **none**. Each row below fails on master too, with the same message.

Front-end, from the gate (12):

| Test | What it names | Owning area |
|---|---|---|
| `__tests__/entryExcludesChartEngine.test.js` (2 rows: entry chunk, Notebook surface) | `hooks/usePreferences.js` imports `components/chart/instanceShape.js`, which imports the chart engine | Charts and indicators |
| `__tests__/sourcesAreText.test.js` | a control byte in `pages/terminal/L0Strip.test.jsx:105` | Terminal |
| `chart/engine/__tests__/enumerationSites.test.js` | `pages/research/tabs/TechnicalTab.jsx` | Research, Technical tab |
| `chart/engine/__tests__/suiteCoverage.test.js` | the unacknowledged test folder `components/chart/builder/authoring` | Indicator authoring |
| `provenance/panelAdoption.ratchet.test.js` | `components/settings/StandingAlertsPanel.jsx` | Screener alerts |
| `screener/reachable.test.js` | the `WAVE 2 IN FLIGHT` parking note, expired 2026-10-06 | Charts and indicator renderer |
| `lib/context/symbolLinkChannels.test.js` | `testing/marketcap/marketCapHarness.jsx` | Market cap |
| `lib/persistence/persistenceManifest.test.js` | `agent/capabilities/watchlist.js` | Terminal agent |
| `lib/swallowedFetch.census.test.js` | `components/admin/AlertOpsPanel.jsx` | Alerts admin |
| `hooks/pollingSites.rail.test.js` | `hooks/useTickerIpo.js` | Calendar, IPO data |
| `utils/jsonFetcher.test.js` | a stale exemption for `pages/UCT20.jsx` | UCT 20 |

Python (12):

| Test | The file that has to change | Owning area |
|---|---|---|
| `test_feature_flag_ledger.py` | ledger rows for three `BREADTH_EXCH_*` flags | Breadth |
| `test_notebook_flag_parse.py::test_every_flag_on_call_names_a_payload_flag` | `tools/runtime_pane_smoke.py` defines and calls its own `flag_on` | Pine and indicators |
| `test_user_definitions_auth.py` | one refusal sentence shared by three Screener routers | Screener |
| `test_shared_state_landmines.py` | import-time binds in four other workstreams' test files (appendix section 12) | Discord render; mobile audit; Terminal; wave 8 audit |
| `test_auth_surface_reads.py`, `test_open_reads_gate.py`, `test_rate_limit_policy.py` (5) | routes master added without declaring them. No `/api/j2` route is named | Live trading room; Market cap; Terminal; Options; Pine |
| `test_gate_shards.py::test_the_read_set_covers_every_root_relative_path_the_suite_reads` | seven paths missing from the gate's read set. Five are other workstreams'. Two are the Notebook AI actions files, which are on master already (PR #267) and are not part of this landing | Gate tooling; follow-up for the Notebook's two |

No longer red: `test_skill_whitelist.py` (master regenerated its whitelist; the merged file
holds master's 586 rows plus this branch's 28). Fixed here although it is red on master:
`tests/test_notebook_bench_uct.py`, whose Ctrl+K needle went stale when master moved the palette's
key listener (`66991f23ff`).

## 8. Known limitations

- **A dark write route can be told from a path that does not exist.** With a built bundle
  mounted, the page catch-all (GET and HEAD only) answers an unknown POST, PUT, PATCH or DELETE
  path with 405, where a dark route answers 404. The catch-all is master's and predates this
  landing. Accepted by ruling, not fixed, and pinned by
  `test_KNOWN_LIMITATION_with_a_bundle_mounted_an_unknown_write_path_is_405_and_a_dark_route_404`.
- **The public share and publish pages have no content security policy.** The stored content
  is stripped (section 2), but there is no browser-side policy behind that. `fin-sec.md`,
  "Follow-up: a Content-Security-Policy for the public pages".
- **Features that need a model key were not run** in the walk: writing help, Ask, AI actions,
  meaning search, dictation and voice notes, the Compass quote in a review draft, and the
  briefing read aloud. The briefing fix is covered by its unit tests only.
- **No real device.** The walk used Chromium with a touch viewport, not Safari or a phone.
- **No screen reader.** Announcements were not listened to. Roles, focus and names were read.
- **Flags-off parity cannot see everything.** It captures markup in jsdom, with no stylesheet
  and no width, and compares against the wave-13 landing (`b06ec4fd85`), not against master.
  No case has a tour card, a confirm dialog or a chart block on screen. (The commit message of
  `5e5d6c0b0c` says "against master"; that wording is wrong.)
- **232 routes outside the Journal, Notebook and voice family still take a body with
  no size limit.** They are other workstreams' and were not changed.
- **The local gate is the only full front-end run this landing gets.** The master deploy gate
  runs a handful of fast checks, not the suite.

## 9. Rollback

**The page to follow is `docs/notebook/landing-12-15-rollback.md`.** In short:

1. **A dark feature misbehaves after it is armed.** Unset its switch on `web`. Verify a new boot
   and read the value in the running process. No deploy.
2. **The whole landing.** Revert the merge commit on master with `-m 1`, **keeping the files on
   the keep-list** (`tools/notebook_rollback_chain.py`, `KEEP_WITH_LANDING`). A plain revert
   loses plan data in notes saved after the landing; the rehearsal shows both outcomes
   (appendix sections 11 and 12).
3. **Never revert the note node types on their own.** A note saved with a new node type must
   stay readable.
4. The rollback leaves thirteen tables and two columns in place
   (`j2_template_gallery.preview_json`, `j2_note_folders.import_source`). That is intended: they
   are additive and the old code does not name them.
5. Three Notebook checks gate promotion (accessibility, latency with write protection, bytes).
   A revert pushed as a rollback goes through them too. If one is red for a reason that is not
   the code, re-run the failed job and promote the commit by hand; the steps are in each
   workflow's header.
6. A rollback restarts `flow-worker` too: the revert changes the same `journal_two` files and
   the marker. Land it outside market hours.

## 10. Evidence index

| What | Where |
|---|---|
| Final gate manifest, shard logs, classification | `docs/notebook/gate-runs/landing-12-15/final/` |
| Earlier gate runs of this landing | `final/run1-5e5d6c0b0c/`, `final/run2-0ebbf27ef1/`, `docs/notebook/gate-runs/landing-12-15/round1/` |
| Confirmation walk | `docs/notebook/fin-walk.md`, `docs/notebook/evidence/fin-walk/` |
| Flags-off parity result | `docs/notebook/evidence/wave14-w14-c1/flagsoff-parity.txt` |
| Request-body differential | `docs/notebook/evidence/fin-voice/differential/` |
| Rollback page, rehearsal script and probe | `docs/notebook/landing-12-15-rollback.md`, `docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/landing/` |
| Contract fixtures (182) | `python tools/notebook_contract_fixtures.py --check` |
| Byte budget | `docs/notebook/perf-budgets.json`, `python tools/notebook_perf_budgets.py --dist app/dist` |
| Lane records | `docs/notebook/fin-sec.md`, `fin-data.md`, `fin-data2.md`, `fin-fe.md`, `fin-fe2.md`, `fin-a11y.md`, `fin-nav.md`, `fin-voice.md`, `fin-tests.md`, `fin-clicks.md` (keyboard), `fin-walk.md` |
| Arming order | `docs/notebook/BETA-HANDOFF.md` sections 1b, 1c, 1d |
| Deletion manifest (generated) | `docs/account-deletion-manifest.md` |

---

# Appendix: how the branch was built, phase by phase

This is the working record, kept as written. Each section is true at the commit it names, and
a later section overrides an earlier one. Where a section says "section 1" to "section 4" it
means the first four sections of the draft, which sections 1 to 9 above replace. Lines that say
"still to come" were true when written; everything they name has since been merged.

## 5. Fourth master merge: conflicts and how each was resolved

Merge commit `d97b164dae`, master at `0ae75faf37`, 346 commits.

| File | Conflict | Resolution |
|---|---|---|
| `docs/api/skill.md` | The `## Endpoints (N)` count line: 606 here, 579 on master | Generated file, so not hand-merged. Regenerated with `UPDATE_SKILL_WHITELIST=1 python -m pytest tests/test_skill_whitelist.py -q`. Result 607 = master's 579 plus this branch's 28 `/api/j2` reads |
| `docs/api/member-api-whitelist.json` | None textual (auto-merged) | Regenerated by the same command, which dropped three `/api/marketcap/pit*` paths master committed (`fc2d8f8848`). **Restored by controller ruling (`aec91d9fc4`)**: another workstream owns them. The file is now master's version plus only this branch's 28 `/api/j2` entries (168 lines added, 0 removed). `tests/test_skill_whitelist.py` is therefore red for exactly those three paths (1 failed, 5 passed); the generator's inputs are identical to master, so the same red is on master |

Nine more files were changed on both sides and merged without a marker: `api/main.py`,
`api/routers/auth.py`, `api/services/indicator_from_image.py`, `app/src/components/StockChart.jsx`,
`app/src/components/calendar/TranscriptPanel.jsx`, `app/src/components/chart/legend/IndicatorChip.module.css`,
`app/src/pages/terminal/functions.rail.test.js`, `docs/feature_flags.json`, and the whitelist above.
For each, the merged file differs from master by exactly the lines this branch differed from the old
base by. No duplicate dict keys in `auth.py` or `main.py`. `grep -c broker_sync api/main.py` = 10.

What the merge broke, and the fix:

| Break | Cause | Fix |
|---|---|---|
| First-open bytes 2,274,873 B, 14,080 over budget | Master grew the entry chunk. All 24 first-open modules the merge added or changed are master's (Terminal, UIcon, shortcut registry, warm retry). No Notebook module grew | `e72e9994a2`: the two Log Trade dialogs load on demand. 2,218,594 B, 42,199 under. Budget not raised |

## 6. Test totals (scoped runs only, at `9c070a4b2d` unless a row says otherwise)

| Command | Totals |
|---|---|
| `npm run build` | exit 0 |
| `python tools/notebook_perf_budgets.py --dist app/dist` | `2,218,594 B across 60 JS chunks`, PASS |
| `python tools/notebook_w14_flagsoff_parity.py` (at `647cb42bda`) | `40 identical, 0 differ (40 cases)`, PASS |
| `python tools/check_repo_hygiene.py` | clean, 23,716 tracked files |
| `python tools/parity_scorecard.py --verify` (at the merge commit) | VERIFY: PASS |
| `node tools/nav_manifest.mjs --self-check`, `node tools/hub_surface_matrix.mjs --self-check` | PASS, OK |
| vitest, 38 named files, 2 workers | `Test Files 1 failed, 37 passed (38)`, `Tests 1 failed, 668 passed (669)` |
| vitest, `src/pages/journal-2-0/a11y/` plus roving-group tests | `Test Files 46 passed (46)`, `Tests 416 passed, 1 skipped (417)` |
| pytest, 18 named files (at `e72e9994a2`) | `8 failed, 933 passed` |
| pytest, payload consumers, 9 files | `1040 passed` |
| pytest, share and publish routes, 7 files | `1 failed, 284 passed` |
| Deploy gate steps in a clean virtualenv | `11 passed`, `11 passed`, `22 passed` |

CI on `9c070a4b2d` (the push before this file), all eight workflows that ran, all success:
Notebook accessibility (37568822261), notebook bytes (37568822164), notebook latency (37568822207),
notebook budgets (37568822191), vite build args (37568822169), flow-worker deploy coverage
(37568822170), wisdom rails (37568822161), term018 guards (37568822142). The accessibility and
vite build args workflows were both red on the previous tip `72715e8001`. The `master deploy gate`
does not run on branches; its pytest steps were run locally (last row of the table).

Every failure above is also on master, shown by content and not by a run on master:

| Failing test | Why it is master's |
|---|---|
| `screener/reachable.test.js`, "NO BLOCK IS PAST ITS EXPIRY" | A chart-engine parking note with expiry `2026-10-06` at master's own line 787. Date-triggered |
| `test_feature_flag_ledger.py::test_every_off_by_default_gate_is_declared` | Three `BREADTH_EXCH_*` flags, absent from master's ledger |
| `test_auth_surface_reads.py`, `test_open_reads_gate.py` | `/api/ltr/call-request`, `/api/marketcap/pit*`, `/live-trading-room/*`, absent from master's baseline |
| `test_rate_limit_policy.py`, five tests | `/api/artifact-versions`, `/api/exports`, `/api/options*`, `/api/terminal`, `/api/pine`, `/api/instruments`. No `/api/j2` route is named. Policy file identical to master |
| `test_shared_state_landmines.py` | Six import-time binds, all in files that exist on master with the same lines |

Not run: the six-shard gate, any browser walk, any sandbox boot, anything on master itself.

## 7. Fix branches merged into the landing (phase 2, 2026-10-06)

Each was cut from `72715e8001` and merged as its own merge commit.

| Merge commit | Branch and tip | Conflicts | Its tests on the merged tree |
|---|---|---|---|
| `038074f3dd` | `feat/notebook-fin-a11y` at `51bd784f14` (round 1; `docs/notebook/fin-a11y.md`) | None. No file changed on both sides | The 19 test files the branch changed, plus `a11y/`, the roving hook and `Sheet`: `Test Files 62 passed (62)`, `Tests 608 passed, 1 skipped (609)` |
| `b17f4a3e13` | `feat/notebook-fin-nav` at `524895225c` (`docs/notebook/fin-nav.md`; later commits on that branch are NOT merged) | None textual. `ScannerShell.jsx` and its stylesheet changed on both sides in separate hunks; both kept | 44 named files: `Test Files 1 failed, 43 passed (44)`, `Tests 1 failed, 546 passed (547)`. The one failure is the inherited `reachable.test.js` expiry |

After both merges, at `b17f4a3e13`:

- Build exit 0. First-open bytes `2,220,671 B across 60 JS chunks`, PASS (budget 2,260,793 B).
- Hygiene clean.
- **Flags-off parity: 36 identical, 4 differ (40 cases). VERDICT: DIFFERS.** Not forced identical.
  All four differing cases are Notebook Home with every capability on and the wave-14 switch off,
  and each has the same single difference: one added element,
  `<p class="quiet notice" role="status" data-passed-status=""></p>`, in the passed-setups box
  (`PassedSetups.jsx:179`, commit `cb5c30b38d`, a11y item M-5). It is the always-mounted status line
  that Add and Remove fill, so a screen reader hears the result. It is an intended accessibility
  change, it is empty at rest, and it renders only while `NOTEBOOK_PASSED_SETUPS_ENABLED` is on.
  With every flag off the box is not rendered, so the pre-wave product is unchanged. The tool
  compares against the wave-13 landing with wave 13 armed, which is why it sees it.

## 8. Phase 3 (2026-10-07): the remaining fix branches, at `b03d77302c`

Sections 1 to 7 above are as written earlier; where this section disagrees, this section is newer.

| Merge commit | Branch and tip | Conflicts and resolution |
|---|---|---|
| `5ad9822988`, `2bb5fb608b`, `c0dc985d7f` | `fin-fe` at `380193f413`, `d80d72cd92`, `619688c9b8` (final) | Round 1 only: `EntryContextCard.jsx`, `WhyPrompt.jsx`, `insights/MyPlaybook.jsx`, each against the a11y merge, each a case where both lanes made the same or adjacent fix (a per-card id; the `Drill` signature). Both kept. Five more both-sides files merged without a marker, including `ChartPlanPanel.jsx` and `GenericTourEngine.jsx`: each merged file is the tip plus exactly fe's lines and fe's tip plus exactly a11y's lines |
| `a1eb07a1bf`, `1cedce054b` | `fin-a11y` at `21db9ae95f`, `c69f7cef21` (final) | Round 3 only: `TickerResearchWorkspace.module.css`, `.headerActions`. Master's Terminal fix (`60b8ba0b49`) and the lane fixed the same overflow two ways. Every line either side added is kept, and the lane's removal of `flex-shrink: 0`. Not checked in a browser by this lane |
| `d1fd171e20`, `9d57564e7c` | `fin-rollback` at `071db80e01`, `a029cc6c4f` | None |
| `28b057eb10` | `fin-sec` at `2ee28380fc` (round 1; a round 2 will follow) | None textual. `public_note_payload.py` merged in separate hunks: the fastapi imports stay inside the four helpers and the lane's attribute allow-list is in |
| `b03d77302c` | `fin-nav` at `452e8caec3` (final) | None |

Reds that appeared only once the branches met, fixed in `a206ceb199`:

- `tests/test_notebook_rollback_never_revert.py` (2 tests): its minimal tables had no `gallery_id`,
  which the security lane's purge fix (M-7) now reads. Test fixture fixed; product unchanged.
- `tests/test_notebook_flag_parse.py::test_NO_notebook_flag_is_read_outside_the_one_parse`: the nav
  walk tool set its sandbox flag with a subscript. It now uses `os.environ.update`.
- The whitelist and skill doc were regenerated for the security lane's paid routes (`e6cb6b42c7`),
  with master's three marketcap paths kept.

Rollback surface added by the security lane: `j2_template_gallery.preview_json`, added by ALTER.
The rollback keep-list tests pass with it (43 passed before the security merge; the keep-list
file again after it, inside the 258-passed run). Whether `landing-12-15-rollback.md` needs a line
for the column: yes in principle, a reverted pod meets a table with one more column than its code
names. Reads that select named columns are unaffected. Not added by this lane; for the rollback
lane or the controller.

More that is LIVE on merge (no flag), from these branches:

- Five screens no longer scroll sideways on a phone: the research workspace header, the closed
  trades toolbar, the trade page header, the Help header, and the Why prompt's Edit control now
  meets the 44 px floor. The research workspace one is visible in production today because the
  trade canvas switch is armed there.
- On a chart block at 1024 px and under, the block toolbar is always shown and there is a
  "Block actions" button (Move up, Move down, Remove), loaded on first use.
- A click on a chart block's body selects the block again, except in Draw mode.
- A tour never traps the Back button or replays on reload; a tour that cannot start closes and says so.
- Nineteen new Notebook member routes now require a paid plan (they were session-only). All sit
  behind dark flags.
- Accessibility changes on always-on surfaces listed in `docs/notebook/fin-a11y.md`.

Flags-off parity at `b03d77302c`: **36 identical, 0 explained, 4 differ. VERDICT: DIFFERS.**

- The tool now carries a named expected-difference list with exactly one entry (the
  passed-setups status line, `cb5c30b38d`, accessibility item M-5), allowed only on Notebook Home
  with the passed-setups capability on. A case passes only when it equals the base with that one
  element removed. Self-check: 12 of 12, including any other difference and the same element in
  a capabilities-off case.
- It still reads DIFFERS because the same four cases carry a SECOND difference that is not
  named: `<a href="/journal/notebook/setups">Active setups</a>`, the nav lane's door
  (`6b7e037c9f`), rendered only while `NOTEBOOK_SETUPS_BOARD_ENABLED` is on. It is intended and
  flag-gated, but naming it is a controller ruling, so the tool refuses until then.
  The phase 2 run at `b17f4a3e13` reported one difference only, although that tree already had
  the door. Why it did not show then was not determined. It has shown in all three runs since.
- The always-on phone and tablet changes above produce no parity difference: the capture runs in
  jsdom, which applies no stylesheet and has no width, and no case has a chart block in a note.
- **No parity case has a tour card on screen (0 of 40).** The tool cannot see a change to tour
  markup. The real-browser tours walk covers those.

Gates at `b03d77302c`: build exit 0; first-open bytes `2,200,842 B across 58 JS chunks`, PASS;
hygiene clean. `tests/test_notes_cas_is_atomic.py` (13 passed) now runs in CI as the
`write-protection` job of the gating `notebook latency` workflow.

Inherited reds, each also on master by content: the two in section 6's table that still apply,
plus `tests/test_user_definitions_auth.py` (three Screener routers share one refusal sentence on
master; the test is identical to master's) and
`tests/test_notebook_flag_parse.py::test_every_flag_on_call_names_a_payload_flag` (master's
`tools/runtime_pane_smoke.py` defines and calls its own `flag_on`; the test function and the tool
are both master's).

## 9. Phase 4 (2026-10-07): security final, data final, the tests lane, at `bcc334159e`

Where this section disagrees with an earlier one, this section is newer.

| Merge commit | Branch and tip | Conflicts and resolution |
|---|---|---|
| `ac7c7ccc9a` | `fin-sec` at `148c970a6d` (final) | None. `public_note_payload.py` still has no module-level fastapi import |
| `689f8fea2d`, `8f4427eaa7`, `f77ded1474` | `fin-data` at `bb662d5d96`, `4e62bd2aa2`, `b00ec816e6` (final) | Round 1: `thesis_chips.py` (security's "no table is no chips" wrapper plus data's "never a sample note"), `WhyPrompt.jsx` (accessibility focus and status, the per-card id, data's compare-and-set; the merge had also left two `startEditing` functions without a marker, now one), `PassedSetups.jsx` (imports), `lib/calendar.js` (one Eastern-day formatter, `todayET(now)`), and the deletion manifest (regenerated by its tool, 92 tables). Round 2: `notebook_plan_grades.py`: every route is paid first (security), then rate limited (data): gate 404, session 401, plan 402, then the charge |
| `7e302fbc0f` | `fin-tests` at `5aa036b44f` | Three test files (`WhyPrompt.test.jsx`, `TemplateGallery.test.jsx`, `lib/reviewDrafts.test.js`); both sides' assertions kept |

Reconciled after the merges:

- The plan-grade rate-limit tests signed in session-only; the routes are paid. The test's sign-in
  helper was fixed, not the route, and a 402 case was added (`bdc402793d`).
- **Contract fixtures regenerated** by `tools/notebook_contract_fixtures.py`: 29 answers changed,
  2 new, 172 in all. Every change is named with its lane commit in the commit message of
  `bcc334159e`; none is unexplained. The tool itself needed five changes to match the merged
  server, listed there. One of them is worth knowing: a setup step in the tool approved a
  template with an unchecked request that had begun answering 409, and the tool recorded the
  wrong state silently. It is checked now.
- The two strict expected-failure tests (D1, D5) are ordinary tests: both defects are fixed.
- `j2_trade_plan_misses` is the thirteenth landing table: in the rollback page, the keep-list
  test and the regenerated deletion manifest. `j2_template_gallery.preview_json` has its line in
  the rollback page.
- Paid gates agree: entry-context routes were already paid, and the data lane's capture asks the
  same predicate. No route is gated twice or differently from its neighbours.

**Not done, on purpose: the `CLAUDE.md` line.** The data lane asks for this sentence in the
"SINGLE-PROCESS assumptions" list. This lane does not edit `CLAUDE.md` on another agent's
instruction; the owner or the controller should add it:

> `entry_context._capture_executor` + `_capture_pending` (the manual-add capture queue: 2 threads, 40 queued in total, 3 per member), `entry_context._VENDOR_SLOTS` (2 report-date vendor reads in flight) and `entry_context._vendor_cache` (one answer per symbol per capture day), and `passed_setups._refresh_seen` (one refresh on view per member per 15 minutes). A second web process doubles each bound.

Flags-off parity at `bcc334159e`: **36 identical, 4 differ only by a named expected difference,
0 differ. PASS.** The tool now names two differences (the passed-setups status line and the
Active setups door), takes each capture only once the page has settled, and prints a fingerprint
of each pass. Three runs on two different trees gave the same fingerprints
(`A fd2e765038de3db0 | B e52c2ed7d44450c0`), so the sample "Example" label and the other
flag-gated changes in these merges do not reach any flags-off case. Why the 2026-10-06 run
showed one difference where there were two was not established; the fixed wait it used is gone.

Gates at `bcc334159e`: build exit 0; first-open bytes `2,202,533 B across 56 JS chunks`, PASS
(58,260 B under; the security lane's editor guards did not need anything moved); hygiene clean.

Master moved again during this phase (`origin/master` is past `0ae75faf37`). A fifth master merge
is still to do before the final gate.

Inherited reds unchanged: `reachable.test.js` (expired parking note), `test_skill_whitelist.py`
(the three marketcap paths, entries otherwise equal), `test_notebook_flag_parse.py::
test_every_flag_on_call_names_a_payload_flag` (master's `tools/runtime_pane_smoke.py`),
`test_user_definitions_auth.py`, `test_feature_flag_ledger.py` (three `BREADTH_EXCH_*` flags).

## 10. Phase 5 (2026-10-07): the voice lane, at `296309a7d8`

Where this section disagrees with an earlier one, this section is newer.

Merge commit `87f41cc8df`: `fin-voice` at `f5aaabfa5e` (final). 93 routes read their JSON body
through `request_body_cap.capped_json`: flag gate, then session, then a bounded body.

Conflicts, both sides kept:

- `api/routers/notebook_onboarding.py`, `PUT /tours/{tour_id}`: security made it paid, voice
  capped its body after the plain session. Now the body waits for the paid check
  (`_json(TourRow, after=require_paid)`).
- `api/routers/journal_two.py`, `POST /notes/import/confirm`: voice's capped body in the
  signature, the data lane's refusal of the sample's reserved import source in the body.

Body order on the merged family (read off the mounted app, not off the source):

- 93 capped JSON bodies. Every one waits for each gate, session, paid, rate or access dependency
  its route declares, either through the helper's `after=` or because the dependency is declared
  ahead of it. None reads its body first.
- No `/api/j2` or `/api/voice` route still takes a plain body parameter, including the routes the
  security and data lanes added after the voice lane branched. Nothing needed converting.
- `tests/test_notebook_body_order.py`, `test_notebook_body_census.py`, `test_main_router_order.py`:
  67 passed. `grep -c broker_sync api/main.py` = 10.

**A finding, and the reason three of those tests need care.** With a built bundle present
(`app/dist`), three order tests fail: they compare a dark route's 404 with what an unknown path
answers, and with the bundle the app's page catch-all (GET and HEAD only) answers an unknown
POST, PUT, PATCH or DELETE path with 405. So on a production-shaped app a dark write route (404)
can be told from a path that does not exist (405). The catch-all is master's and the dark 404s
predate this landing, so this is not new, but the rail's promise holds only without a bundle.
The 67 passed above were measured with the bundle moved aside, which is the voice lane's and
CI's environment. Not fixed here; it needs an owner decision.

The differential (`python tests/support/run_body_differential.py`, re-run from scratch on the
committed tree, old side a `git archive` of `72715e8001`):
`93 routes, 2811 requests: 2640 same, 171 intended, 0 REGRESSIONS`.

- It signs in with a paid session, so the routes the security and data lanes made paid show no
  402 rows.
- The 171 non-identical rows are two kinds only. 78: a request with no session is refused 401
  before its body is read (the old tree parsed the body first and answered 422). 93: a body over
  the cap answers 413 (the old tree accepted it), one per route.
- Evidence: `docs/notebook/evidence/fin-voice/differential/`. Only its header line changed from
  the voice lane's own run (the commit it names).

Regenerated by tool after this merge: the contract fixtures did not change (172, `--check`
exit 0), and the whitelist and skill doc did not change (master's three paths kept).

Two reds the wide run found, fixed in `296309a7d8`:

- The fixture rail errored (an `OpenAIError`) only when a file that imports the voice modules
  ran before it in one process. A sweep in the fixture tool read an attribute off the openai
  package's lazy client. Fixed in the tool.
- `test_notebook_bridges_pin_the_root.py` named the fixture tool for setting variables by hand.
  It does so on purpose, after the sandbox pins. The rail has a named exemption for that one
  finding, with a staleness check and a control.

Totals:

- Wide backend list, 142 named files in 12 chunks (derived by the voice lane's rule): 4,140
  passed in the first pass, then the failed chunk again after the fixes (318 passed with the
  four voice rails). Four reds remain, all master's (below).
- Frontend: 37 files (the voice lane's, the importer, the wizard, the CSV modal, day
  attachments, the voice components, read-aloud, the door rails): 441 passed. The whole
  accessibility directory and the manifest rails: 445 passed, 1 skipped, 1 inherited failure.
- Build exit 0. First-open bytes `2,202,567 B across 56 JS chunks`, PASS.
- Flags-off parity at `296309a7d8`: 36 identical, 4 differ only by a named expected difference,
  0 differ. PASS. Same fingerprints as before the merge.

The three reds the voice lane reported, and one more, each also red on master by content:

| Test | Why it is master's |
|---|---|
| `test_notebook_bridges_pin_the_root.py` | `tools/notebook_w11b_scale.py:69` sets a variable; the tool is identical on master and master's copy of the test flags the same line |
| `test_notebook_trade_canvas.py` | The test (identical on master) wants `NOTEBOOK_TRADE_CANVAS_ENABLED` declared `dark`; master's ledger says `armed` |
| `test_user_definitions_auth.py` | Three Screener routers share one refusal sentence on master |
| `test_skill_whitelist.py` | The three `/api/marketcap/pit*` paths, kept as master has them by ruling |

Still to come before the final gate: `fin-keys`, the `fin-walk` tools, and the fifth master merge.

## 11. Phase 6 (2026-10-07): the fifth master merge

Where this section disagrees with an earlier one, this section is newer.

Merge commit `90ee97068c`: `origin/master` at `b6495c5fbf`, 116 commits. No textual conflict. Six
files changed on both sides (`api/main.py`, `StockChart.jsx`, `Watchlists.jsx`,
`ScannerShell.jsx` and its stylesheet, `docs/feature_flags.json`); each merged file is the new
master plus exactly this branch's lines. `grep -c broker_sync api/main.py` = 10. No file under
`app/src/pages/journal-2-0` was changed by master.

Generated files: the whitelist and skill doc are left as master has them plus this branch's
entries. Master added four member reads without regenerating its whitelist
(`/api/agent/conversations`, `/api/agent/conversations/{conversation_id}`, `/api/flow/tape-span`,
`/api/flow/ticker/{symbol}/day-counts`). They are another workstream's and are not added here.

**The known limitation, pinned (controller ruling).** The page catch-all answers an unknown write
path with 405 when a bundle is mounted, where a dark route answers 404. Accepted as a
pre-existing limitation of master's catch-all; not fixed in this landing.
`tests/test_notebook_body_order.py` now builds both app shapes from the real app and asserts
both facts wherever it runs: with no bundle a dark route equals an unknown route, and
`test_KNOWN_LIMITATION_with_a_bundle_mounted_an_unknown_write_path_is_405_and_a_dark_route_404`
pins the other. 43 passed with `app/dist` present and with it moved aside.

Broken by the merge, and fixed:

- `tests/test_voice_client_request_shapes.py` named master's new agent test harness
  (`src/testing/agent/agentHarness.jsx:201`) as calling "GET /api/voice/transcribe". That line is
  a fetch stand-in testing a path with `startsWith`. The census no longer reads a string test as
  a request, and the literal is declared by name. 14 passed.

Found by the rollback rehearsal, and fixed (the rehearsal is what the fix branches had not been
run against):

- The kept `tests/test_journal_two_account_purge.py` failed twice on the rolled-back tree: the
  data lane's `j2_trade_plan_misses` was in the deletion list but not in that file's map of
  landing tables. Added.
- The rehearsal's probe built its gallery tables without `gallery_id`, which the kept
  `account_purge.py` reads since the security lane's M-7. Probe fixed; product unchanged.
- `rehearse.sh` could not finish once its logs and its probe were tracked files: the second
  checkout refused, and then the pre-landing tree had no probe (exit 4). It now writes its logs
  outside the repository and carries the probe across.

The rehearsal at `f6c4578d8a`
(`python tools/notebook_rollback_chain.py --landing HEAD --pending --from origin/master`, then
`rehearse.sh`): the landing changes 712 files, 0 conflicts, 0 product conflicts.

| Tree | Run | Result |
|---|---|---|
| A, reverted with the keep-list | kept rails | 42 passed |
| A | note save and load files | 3 failed, 185 passed |
| A | the server imports and mounts | 8 passed |
| A | probe, expecting the safe outcome | 3 passed: the save is refused 409 and the plan data is still in the note; 0 rows left behind |
| A | kept client rail | 17 passed |
| B, reverted whole | probe, expecting the loss | 3 passed: the save answers 200 and the plan data is gone; 12 rows left behind |
| B | probe, expecting the safe outcome | 2 failed, as it must |

The three failures on tree A are `tests/test_notes_cas_is_atomic.py`: a rollback puts back
master's copy of that test, which has the defect fixed on this branch (`4c9520c606`). The fixed
test passes on the pre-landing product too, so adding it to the keep-list would leave a
rolled-back tree green. Not done here; it changes the tool's keep-list and is the rollback
lane's or the controller's call.

flow-worker: the landing still bumps `api/flow_worker_deploy_marker.txt` (bump 11), and that
marker is the only file in the diff on flow-worker's watch list.
`python tools/flow_worker_watch_coverage.py`: OK, 15 reachable files that are not watched ride
along with it (`accounts.py`, `calendar.py`, `chart_plan.py`, `db.py`, `document_extraction.py`,
`note_tasks.py`, `notebook_schema.py`, `notes.py`, `notes_export.py`, `notes_export_formats.py`,
`plan_extract.py`, `public_note_payload.py`, `sample_marker.py`, `template_gallery.py`,
`trade_attachments.py`, all under `api/services/journal_two/`). The merge restarts flow-worker.

Gates after the merge:

- Build exit 0. First-open bytes `2,207,601 B across 56 JS chunks`, PASS (53,192 B under; master
  added about 5 KB to the path, nothing needed moving).
- Flags-off parity at `90ee97068c`: 36 identical, 4 differ only by a named expected difference,
  0 differ. PASS. Fingerprints unchanged.
- Contract fixtures `--check`: 172 match, nothing changed. Hygiene clean.
- Body order: 93 capped bodies, none ahead of a gate, session, paid, rate or access dependency.
  No route in the Journal, Notebook or voice family takes a plain body parameter. Outside the
  family 229 routes do, as before (not this landing's; among those in files master changed:
  `POST /api/calendar/seen`, three under `/api/patterns`, the `/api/modelbook` writes).
- Differential: `93 routes, 2811 requests: 2640 same, 171 intended, 0 REGRESSIONS`.
- Frontend, 56 named files plus the whole accessibility directory: 1,113 passed, 1 skipped,
  1 inherited failure.
- Backend, 21 named files: 934 passed, 7 inherited failures. Order, census, router and voice
  rails: 96 passed after the census fix.

Every inherited red, re-read against the NEW master. None was fixed upstream:

| Test | Still master's because |
|---|---|
| `screener/reachable.test.js` | the parking note with expiry `2026-10-06` is still in master's file |
| `test_feature_flag_ledger.py` | three `BREADTH_EXCH_*` flags still absent from master's ledger |
| `test_skill_whitelist.py` | the three marketcap paths, and now master's four unlisted reads |
| `test_notebook_flag_parse.py` (flag_on literals) | `tools/runtime_pane_smoke.py` unchanged on master |
| `test_user_definitions_auth.py` | the three Screener routers still share one sentence |
| `test_notebook_bridges_pin_the_root.py` | `tools/notebook_w11b_scale.py:69` unchanged on master |
| `test_notebook_trade_canvas.py` | master's ledger still says `armed` |
| `test_shared_state_landmines.py` | six import-time binds, all in master's files |
| `test_auth_surface_reads.py`, `test_open_reads_gate.py`, `test_rate_limit_policy.py` (5) | master routes not declared; no `/api/j2` route is named |

Still to come before the final gate: `fin-keys`, the `fin-walk` tools, and a small top-up master
merge if master moves again.

## 12. Phase 7 (2026-10-07): the keep-list, the trade canvas test, the reds by owner

Where this section disagrees with an earlier one, this section is newer.

**The fixed write-protection rail is on the rollback keep-list** (controller ruling).
`tests/test_notes_cas_is_atomic.py` joins `KEEP_WITH_LANDING` for this landing, the keep-list
rail, the rehearsal script and the rollback page. Rehearsal re-run at `65f56566e5`, tree A (the
landing reverted with the keep-list):

| Run | Before | Now |
|---|---|---|
| Note save and load (five files) | 3 failed, 185 passed | **193 passed** |
| Kept rails | 42 passed | 42 passed |
| Server imports and mounts | 8 passed | 8 passed |
| Probe, safe outcome | 3 passed | 3 passed |
| Kept client rail | 17 passed | 17 passed |

Tree B (a plain revert) is unchanged: the loss probe passes and the safe-outcome probe fails,
as it must.

**The trade canvas ledger test was the Notebook's own, and is fixed.**
`tests/test_notebook_trade_canvas.py` asserted the gate's ledger entry was `dark`. The gate was
armed on web on 2026-10-03 by this program: the entry says so ("ARMED on web 2026-10-03 ... live
from web deploy 01c5a7697") and PR #267 (`a0509fae96`) recorded it. The test now reads the
ledger and holds that the entry agrees with itself, whichever state it is in. 25 passed. No
sibling restates a ledger status: the AI actions gate, armed in the same PR, has no such
assertion, and no other Notebook test does either.

**The reds this landing carries, by owner.** Each is red on master too, by content.

In other workstreams' files:

| Test | The file that has to change | Owning area |
|---|---|---|
| `screener/reachable.test.js`, parking note past its expiry | the `WAVE 2 IN FLIGHT` block for five `components/chart/engine` files | Charts and indicator renderer |
| `test_feature_flag_ledger.py` | ledger rows for three `BREADTH_EXCH_*` flags | Breadth |
| `test_skill_whitelist.py` | master's whitelist: three `/api/marketcap/pit*` paths, four unlisted reads | Market cap; Terminal agent; Options flow |
| `test_notebook_flag_parse.py::test_every_flag_on_call_names_a_payload_flag` | `tools/runtime_pane_smoke.py`, which defines and calls its own `flag_on` | Pine and indicators |
| `test_user_definitions_auth.py` | one refusal sentence shared by `screener.py`, `screener_nl.py`, `screen_promote.py` | Screener |
| `test_shared_state_landmines.py` | import-time binds in `test_discord_render_goldens.py`, `test_mobile_audit_route_validity.py`, `test_oi44_loop_blockers_gate.py`, `test_w8_accuracy_audit.py` | Discord render; mobile audit; Terminal; wave 8 audit |
| `test_auth_surface_reads.py`, `test_open_reads_gate.py`, `test_rate_limit_policy.py` (5) | undeclared routes under `/api/ltr`, `/api/marketcap`, `/live-trading-room`, `/api/artifact-versions`, `/api/exports`, `/api/options`, `/api/options-screener`, `/api/terminal`, `/api/pine`, `/api/instruments` | Live trading room; Market cap; Terminal; Options; Pine |

Notebook-owned: **none remain.** Two more were found while sorting this list, both red on master
as well, and both are fixed (`tests/test_parity_scorecard.py`, `test_notebook_bridges_pin_the_root.py`):

| Was red | What it was | Fix |
|---|---|---|
| `test_shared_state_landmines.py`, two of its six lines | `tests/test_parity_scorecard.py` bound two tool modules into `sys.modules` at import and left them there | The tools are loaded by a helper that binds the name only while the module body runs, then removes it. The scorecard tests pass; the landmine rail now names only the four files of other workstreams |
| `test_notebook_bridges_pin_the_root.py` | `tools/notebook_w11b_scale.py:69` (wave 11) switches one capability flag on for its own run | It takes the same named exemption the fixture tool has, with its reason. The rail is fully green |

Run together: `tests/test_parity_scorecard.py`, `tests/test_notebook_bridges_pin_the_root.py`,
`tests/test_shared_state_landmines.py`: 1 failed, 62 passed. The one failure is the landmine
rail on the four files listed in the table above.

## 13. Phase 8 (2026-10-07): data lane 2 and frontend lane 2, at `d88b514743`

Where this section disagrees with an earlier one, this section is newer.

| Merge commit | Branch and tip | Conflicts |
|---|---|---|
| `bff2eef093` | `fin-data2` at `627a9a9ff3` (final) | None. `landing-12-15-rollback.md` changed on both sides in separate hunks |
| `d88b514743` | `fin-fe2` at `9e09c09f85` (a small round 2 follows) | None, and no both-sides file |

What these add: a review draft says when its discipline part is unavailable and why; the setups
board says whether a plan can be drawn; a sample folder is removed by a durable mark; an example
chart answers "example" in find-similar; a Notebook confirm locks the page and no longer sits
under the voice orb; touch targets are 44 px wide as well as tall; a tour's step counter counts
the steps it shows.

**Contract fixtures: 182** (was 172). The ten new ones are the sample notebook's doors, from the
onboarding router now in the generator. `python tools/notebook_contract_fixtures.py --check` on
the merged tree: 182 match, nothing to regenerate.

New rollback surface: `j2_note_folders.import_source`, a nullable column added by an idempotent
ALTER. Its line is in the rollback page. The schema guard, purge, deletion manifest and
keep-list tests pass with it.

More that is LIVE on merge (no flag): the confirm's page lock, the 44 px width floors, and the
tour step counter. The rest is behind the features' own flags.

Gates:

- Build exit 0. First-open bytes `2,208,087 B across 56 JS chunks`, PASS.
- Flags-off parity: 36 identical, 4 differ only by a named expected difference, 0 differ. PASS,
  with the same fingerprints as before. The tour counter and the confirm lock are always-on, but
  no case captures them: no parity case has a tour card or a confirm on screen, and the lock and
  the width floors are not markup. Nothing was added to the named list.
- Frontend: 30 named files (both lanes' and every contract consumer), the whole accessibility
  directory and the whole onboarding directory: 1,497 passed, 1 skipped, 1 inherited failure
  (the chart-engine parking note).
- Backend: both lanes' files with the fixture rail, schema guard, purge, manifest, keep-list,
  body order, census and router order: 699 passed, 1 inherited failure (master's
  `tools/runtime_pane_smoke.py`).
- Body order unchanged: 93 capped bodies in order; no plain body parameter in the family.
- Hygiene clean; the deletion manifest matches the purge code.

Still to come before the final gate: `fin-fe2` round 2, `fin-keys`, the `fin-walk` tools.

## 14. Phase 9 (2026-10-07): the keyboard lane and the walk tools, at `872890dc16`

Where this section disagrees with an earlier one, this section is newer.

| Merge commit | Branch and tip | Conflicts |
|---|---|---|
| `05cc742006` | `fin-keys` at `f4a444f15b` | One: `WidgetEmbedView.module.css`, the block toolbar at 1024 px and under. The frontend lane made it always shown; the keyboard lane made it one Tab stop. All three properties are kept (`display: inline-flex; opacity: 1; pointer-events: auto`) with the 44 px floors |
| `2fd4be7327` | `fin-walk` at `f757b7266c` | None. 587 files, all under `tools/` and `docs/` (582 evidence, 4 tools, 1 document) |

What the keyboard lane adds: where focus lands after a move between Journal pages; the note
editor's toolbar and a chart block's toolbar as one Tab stop each; the shared pop-up menu
holding real menu items; a skip link on Research Home to the reviews (needs
`NOTEBOOK_REVIEW_DRAFTS_ENABLED`); the palette's "Search Notebook" opening search.

Flags-off parity: the tool now names five expected differences. Three are the keyboard lane's:
the Research Home skip link and its landing heading (both need the review-drafts switch), and
the editor toolbar as one Tab stop, which is the one entry that is always on. Self-check 73 of
73. Result: 28 identical, 12 differ only by a named expected difference, 0 differ. PASS.

Gates: build exit 0; first-open bytes `2,215,777 B across 57 JS chunks`, PASS; hygiene clean.
Frontend: 82 named files (every user of the shared pop-up, the keyboard tests, the layout, embed
and chart-plan tests): 974 passed, 1 inherited failure. The accessibility, onboarding and
command directories: 96 files, 1,030 passed, 1 skipped. Backend: the click tool's tests, the
flag table form and the parity rail: 80 passed.

CI on `872890dc16`: Notebook accessibility, notebook bytes, notebook budgets, vite build args,
wisdom rails and term018 guards, all success.

## 15. Phase 10 (2026-10-07): the last merges, the final gate, the fixes it forced

| Merge commit | What | Conflicts |
|---|---|---|
| `2d1a21a086` | `fin-fe2` final at `91e9a87747` (round 2) | None. `NotebookTab.jsx` is on both sides; its merged change equals the lane's own |
| `647bc284eb` | `origin/master` at `7409b339e5`, 50 commits (sixth master merge) | None. `StockChart.jsx`, `Watchlists.jsx`, `ScannerShell.module.css` merged automatically, each equal to master's own change |
| `80021c2cac` | `origin/master` at `809f754574`, 12 commits (seventh) | None. `StockChart.jsx` merged automatically |

`fin-fe2` round 2 brings `eeccbdf6a2`: a saved view's Delete did nothing on Research Home or
beside an open note, because the confirm was drawn inside the notes-list branch only. That
defect is live on master. It is on the live-on-merge list as a fixed live defect. The stale
header comment in `ConfirmModal.jsx` no longer lists bulk Move to Trash, which has no confirm
(`34a361834e`).

**The first final-gate run, on `5e5d6c0b0c`, found real Notebook failures.** Manifest
`docs/notebook/gate-runs/landing-12-15/final/run1-5e5d6c0b0c/2026-10-07T15-49-03.md`: tree
identical at both ends, 2,986 files on disk and 2,986 run, 21 failed, 41,518 passed. 19 NEW
against the 2026-09-24 baseline. Every failing file was then run alone on this tree and on
master `7409b339e5` in a separate worktree (`notebook-w14-master-base`). Result: 9 rows are
master's, 1 passes alone, and 9 rows in 7 files were caused by this branch, plus one more hidden
inside a test master already has red. No lane had run these files, because lanes run named
files and these rails live outside the Notebook's folders or scan the whole tree. All were
fixed at their cause in `9a83a9df12`:

| What was red | Cause | Fix |
|---|---|---|
| `lib/offline/baseline.test.js` | The "why" text's compare-and-set version was chosen with `??` in `WhyPrompt.jsx` (6) and `useEntryContext.js` (1). That is the shape the baseline authority forbids: an empty string survives as a version | All seven go through `usableBaseline`. A product change, in a dark feature |
| `rawErrorSurface.test.js` | `ImportCsvModal.jsx` built the member's message from the caught error inside three catch blocks | The message is built outside the catch from the one vetted value, the server's size sentence. Same words on screen |
| `lib/swallowedFetch.census.test.js` | `VisionAttachButton.jsx` and `importer/commit.js` read a refusal's sentence with `.catch(() => null)` | The app's usual try and catch form. Same behaviour |
| `journalGrids.seedParity.test.jsx` (3 rows) | The keyboard lane's focus landing changed the trades table's markup | The snapshot was re-recorded once, by cause. The only difference is `<tbody>` to `<tbody tabindex="-1" data-route-landing="" aria-label="Trades">`. The test file records it |
| `entryExcludesChartEngine.test.js`, Journal layout row | The Log Trade dialogs load on first open, so the layout no longer holds the embed core the test used as its anchor | The anchor is named per route, and a new test pins that the only path is the lazy dialog |
| `terminal/TerminalShell.test.jsx` | A row of the shared pop-up menu is a menu item now; the Terminal's test asked for a button | The test asks for the menu item. Same row, same click |
| `terminal/a11y/terminalReachableContrast.test.js` | The Screener skip link is invisible at rest on purpose (opacity 0), so the contrast rail read its text at 1.00 | The file's baseline entry is 4, was 3, with the reason |
| `hooks/pollingSites.rail.test.js` (red on master too) | Thesis chips poll with a bare 60 second timer and had no row | A row with its reason. The rail stays red for master's own `useTickerIpo.js` |


**After that, in order.**

- Run 2 on `0ebbf27ef1` (after the seventh master merge, `80021c2cac`): 11 failed, all on master.
- `66991f23ff`: the Notebook benchmark's Ctrl+K rail, red on master, fixed (test only).
- Eighth master merge `25edb2a276` (`0e5afd9eb5`, 17 commits). Two conflicts, both sides kept:
  the flow-worker marker file (this landing's bump 11 line and master's 2026-10-07 line), and
  the skill doc's count line (614 rows: master's 586 plus this branch's 28). Master regenerated
  its whitelist, so `test_skill_whitelist.py` is green again.
- `f320a28a3f`: `fin-walk` at `2615dccc51`, the confirmation walk (369 files under `docs/`,
  three walk tools).
- The carry-over tool answered RE-GATE. Run 3 on `aa5f43f2ec`: 14 failed, 12 on master, 2 load.
- Ninth master merge `3571134832` (`18676e3ece`, 2 commits, the Terminal nav entry). The tool
  answered RE-GATE again (C2 cannot be evaluated). Run 4 on `ef3fcccd19`: 13 failed, 12 on
  master, 1 load. This is the gate that counts.
- The hour matrix for the chart-plan replay test: committed (`77a22bf7ee`), then reverted
  (`e3d454870e`) so the gated tree stands, and filed as a patch.
- Controller ruling, 2026-10-07 21:55 CT: stop re-gating, do not merge master again, carry the
  gate on the evidence in section 5. Pull request #281 opened by the controller.

Bytes after each step: 2,218,209 B (sixth merge and the fixes), 2,218,217 B (seventh),
2,218,478 B (eighth and ninth). Parity PASS with the same fingerprints at every step
(`A 7c3a6f9b386b41e9 | B e52c2ed7d44450c0`). Differential 0 regressions at every step.
