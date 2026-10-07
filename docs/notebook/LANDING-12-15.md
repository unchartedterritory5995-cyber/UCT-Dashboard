# Notebook landing, waves 12 to 15

> **DRAFT. Not final.** Written by the landing lane on 2026-10-06 after the fourth master merge.
> The six-shard gate has NOT been run on this tree yet; other lanes are still adding fixes, and one
> final gate runs after them. Every number below names the commit it was measured at.

Branch `feat/notebook-w14-land`. Merge base with master: `0ae75faf37` (fourth merge, `d97b164dae`).
Tip when this draft was written: `9c070a4b2d` (before this file was committed).

## 1. What lands

| Wave | What it is | Reaches members on merge? |
|---|---|---|
| 12 | Community template gallery: publish a copy of one of your templates, browse, copy, report | No. `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` |
| 13 | Trading and research features: plan grading, My Playbook, earnings prep, resurfacing, entry context, review drafts, passed setups, transcript capture, thesis chips, chart plan, technical fingerprint, visual playbook, find similar, setups board | No. One flag each, section 3 |
| 14 | Onboarding: get-started checklist, sample notebook, tours registry, tour offer, What's new, keyboard doors | No. Needs `NOTEBOOK_ONBOARDING_ENABLED` and `NOTEBOOK_GETTING_STARTED_ENABLED` both on |
| 15 | Evidence: parity scorecard re-score, walks, gate records | Docs and tools only |

Size of the three-dot diff against master at `9c070a4b2d`: 2,221 files, of which 72 are under `api/`.
Most of the file count is committed evidence under `docs/notebook/`.

## 2. What is LIVE on merge (no flag)

Each row was checked against the diff, not taken from a plan.

| Item | Where | What a member notices |
|---|---|---|
| Upload size caps answer 413 while the body is read | `api/services/request_body_cap.py` (new), used by `api/routers/journal_two.py`, `voice.py`, `notebook_voice_notes.py`, `notebook_personal_api.py`, `avatar.py`, `community.py`, `desk.py`, `indicator_vision.py` | An upload over the cap is refused with 413 and the same sentence as before, instead of being read whole first. The caps themselves did not change |
| CSV mapped-import fix | `api/routers/journal_two.py` (`preview-mapped` now reads the `mapping` form field the import dialog sends) | The column mapping chosen in the import dialog is applied |
| Playbook fixes | `api/services/journal_two/playbook_stats.py` (`untagged_count`, sample-size wording, drill rows) | Insights > Playbook numbers. NOT verified in a browser by this lane |
| Lazy dialogs, Journal header | `JournalLayout.jsx`: Portfolio settings, New account, Generate report load on first open | A short pause the first time each dialog opens |
| Lazy dialogs, Log Trade (added by this lane, `e72e9994a2`) | `LogTradeButton.jsx`, `JournalLogFab.jsx`: Add position and Add trade load on first open | Same short pause on the first "Log open position" or "Log closed trade" |
| AI actions box loads on demand (`c89c5a4c2d`) | `ResearchHome.jsx` | Only while `notebook_ai_actions_enabled` is on: the box appears once its code arrives |
| Roving Tab stop chosen before paint (this lane, `647cb42bda`) | `app/src/hooks/useRovingTabIndex.js` | The Journal's top tab bar is never briefly out of the Tab order |
| Three existing gates read through one parser | `note_semantic.py`, `note_tasks.py`, `document_extraction.py` now call `notebook_flags.flag_on` | Nothing. Same answer for every spelling (`tests/test_notebook_flags.py`) |
| New tables created at boot | `journal_two/db.py::ensure_schema` creates the gallery tables and the wave-13 tables; the firm templates are seeded once | Nothing visible. Additive, idempotent |
| Chart-plan line in note exports | `notes_export.py`, `notes_export_formats.py` | Only for a chart block whose drawings carry plan roles, which needs the dark chart-plan feature to create |
| Schema node types | `journal_two/notebook_schema.py` and the client schema | New node types are accepted by the server. See rollback, section 4 |
| **flow-worker restarts** | `api/flow_worker_deploy_marker.txt`, bump 11 | The options tape drops for the length of the restart and Massive does not replay it. **Land this after hours** |
| Schema layer imports no web framework (this lane, `1a7dd79ff8`) | `journal_two/public_note_payload.py` | Nothing. It unblocks the deploy gate |

Open for the controller: this lane did not walk any of these in a browser.

## 3. New flags

All are read per request on `web` and ride the auth payload. All default OFF (unset means off).
All are declared `dark` in `docs/feature_flags.json`.

| Flag | Wave | Turns on |
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

Caps that are settings, not gates: `NOTEBOOK_GALLERY_PUBLISH_DAILY_CAP`, `NOTEBOOK_GALLERY_REPORT_DAILY_CAP`,
`NOTEBOOK_EARNINGS_PREP_DAILY_CAP`. Order of arming and which flags depend on which: `BETA-HANDOFF.md` section 1.

Three existing ledger entries changed their text only (`NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED`,
`NOTEBOOK_SEMANTIC_SEARCH_ENABLED`, `NOTEBOOK_TASK_REMINDERS_ENABLED`); their live values are untouched.

## 4. Rollback

1. **A dark feature misbehaves after it is armed.** Unset its flag on `web`. Verify a new boot and
   read the value in the running process. No deploy.
2. **A live-on-merge item misbehaves.** Revert the commit that carries it and push to master. Each
   item this lane added is its own commit: `e72e9994a2` (Log Trade dialogs), `647cb42bda` (Tab stop),
   `1a7dd79ff8` (import seam; reverting this one turns the deploy gate red again, so do not).
3. **The whole landing.** Revert the merge commit on master with `-m 1`. Open tabs keep the old
   bundle until they reload.
4. **Do not revert the schema node types on their own.** A note saved with a new node type must stay
   readable. Same rule as waves 5 and 6: `docs/notebook/wave5-rollback.md`.
5. Three Notebook CI checks gate promotion (accessibility, latency, bytes). A revert pushed as a
   rollback goes through them too.

Not covered here and reported by the review lane: `tools/notebook_rollback_chain.py` does not yet name
waves 11 to 15.

## 5. Fourth master merge: conflicts and how each was resolved

Merge commit `d97b164dae`, master at `0ae75faf37`, 346 commits.

| File | Conflict | Resolution |
|---|---|---|
| `docs/api/skill.md` | The `## Endpoints (N)` count line: 606 here, 579 on master | Generated file, so not hand-merged. Regenerated with `UPDATE_SKILL_WHITELIST=1 python -m pytest tests/test_skill_whitelist.py -q`. Result 607 = master's 579 plus this branch's 28 `/api/j2` reads |
| `docs/api/member-api-whitelist.json` | None textual (auto-merged) | Regenerated by the same command. It dropped three `/api/marketcap/pit*` paths from `excluded_no_rate_family`. Those came from master (`fc2d8f8848`). The generator gives them no tier, and every input to that decision is identical to master, so the drift is master's own |

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
