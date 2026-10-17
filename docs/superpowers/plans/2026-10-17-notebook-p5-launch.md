# Notebook P5: Launch Implementation Plan (starter packs, tours, capability lines, measurement)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn journal styles and the community library into daily use. P5 adds:
- **Starter packs.** The first time a member meets styles, "How do you trade?" offers five packs: Swing, Day, Prop, Options and Earnings. Each pack installs three firm styles the member can edit.
- **Two tours** in the Learn menu: "Journal styles" and "Community library".
- **Two lines in "See what it can do"**, one for styles and one for the library.
- **Three telemetry events:** `style_applied`, `style_created`, and `block_used` (its `kind` comes from the block registry).
- **An announcement draft** and a weekly featured-style runbook for the owner.

All of it is dark behind `NOTEBOOK_STARTER_PACKS_ENABLED`. The exceptions are the tours, the capability lines and the events, which ride the existing styles and library switches.

**Architecture:**
- **Firm styles are gallery rows.** A new seed file `template_gallery_style_seed.json` holds 15 firm `style` items, 3 per pack. Each row is tagged with its `trading_style`.
  - They are seeded beside the firm outlines by a sibling `seed_firm_styles(conn)`, using the same `INSERT OR IGNORE` by `seed_key`.
  - A pack is the set of firm style rows whose `trading_style` matches.
- **Installing a pack** reuses P3a's `adopt_style` service function for each firm row. It does not go through the adopt route, so it works with the library switch off; firm rows are not community content.
  - It runs through one new endpoint, `POST /api/j2/journal-styles/starter-packs/{pack}`.
  - It is idempotent: a firm row the member has already adopted is skipped.
- **The offer** is a card at the top of the lazy `KindSection` and in the Styles manager's empty state.
  - It shows while the member has no styles of their own and the new preference `notebook_starter_pack` is unset.
  - Choosing a pack or dismissing the card writes that preference.
- **Tours** are one new track file, `tours/b4Styles.js`, holding two thin registry entries. Their steps and copy are lazy.
- **Telemetry:**
  - **Names and schemas** go in `notebookTelemetry.js`, the server allowlist and its schemas.
  - **Call sites:**
    - `style_applied`: once in `createNoteViaApi` after a successful create that carried `styleId` or `kindId`, and once in `StyleHost.finish`.
    - `style_created`: in `journalStyles.createJournalStyle`.
    - `block_used`: in `insertWidgetEmbed`, only for registry entries with `block: true`.
- **Bytes.** The first-open closure grows by the two tour entries, the three event schemas and one `FLAG_FALLBACKS` row. Everything else is lazy.

**Tech Stack:** React + Vite, vitest + Testing Library, FastAPI, SQLite, pytest, Python Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md`, §P5 (lines 345-357) and §6 (361-378).

**Code map** (2026-10-17 scout, read from `origin/master` and `origin/notebook-p3a-library`). It is summarised in the Facts section below, which is the plan's authority for file:line. Task 1 re-reads every one.

**Depends on, all merged to master before Task 1:**
- P3a: `adopt_style`, `item_type`, `trading_style`, and the events `style_adopted` / `library_viewed`.
- P4a.
- PR #373 (the 24 KB headroom).

**Base:** `origin/master` at that point. Worktree `C:\Users\Patrick\uct-worktrees\notebook-p5`, branch `notebook-p5-launch`, with a `.uct-session-owner` file.

## Facts (from the code map; Task 1 re-verifies)

| # | Fact | Where |
|---|---|---|
| F1 | A tour entry is `{id, flag, title, replayable, start, load}`, optionally `requires`, assembled by `assembleRegistry`. Tracks are spread into `TRACK_TOURS` from `tours/index.js`: one import plus one spread per track. | `ON/tourRegistry.js:50,63,122,164`; `ON/tours/index.js:78-87` |
| F2 | Steps are `[{id, anchor, file, waitFor?}]`. A replayable tour has 3-6 steps. Copy is `{[stepId]: {title, body}}`, with no em dash, en dash or `!`. | `b1TemplateGallery.steps.js:16-40`; `tourRegistry.test.js:115-147` |
| F3 | Every anchor is a literal `data-tour="x"` that appears exactly once in its step's `file`. A tour cannot open a closed dialog itself, so it uses a `waitFor` step and the member clicks. | `tourAnchors.test.js:112-126`; `GenericTourEngine.jsx:313-331,515` |
| F4 | Two rails hold exact tour counts: `OTHER_TOURS` has length 21 and the expected eligible list has length 20. `ROUTE_OF_FILE` needs one entry per anchor file, and a lazy dialog's file maps to `() => false`. | `tourReachability.test.jsx:34-59,125`; `tourEligibility.realRegistry.test.js:22-24,59` |
| F5 | `LEARN_GROUPS = ['Basics','Writing and capture','Trading','Research']`. Each replayable tour needs a `GROUP_OF` row, and the group list is pinned. | `ON/learnTours.js:37,40-48`; `learnTours.test.js:175-205` |
| F6 | `CAPABILITY_PREVIEW` entries are `{id, flag, label, line}`. Ids and flags are each unique, the flag falls back to false, and a line is at most 120 characters with no em dash and no `!`. The preview is lazy. | `ON/capabilityList.js:19-100,115`; `capabilityList.test.js:25-51` |
| F7 | Telemetry names are lowercase snake case. `EVENT_SCHEMAS` uses `oneOf('a','b')` with LITERAL strings, because the Python rail parses the text. Keys named `title`, `body`, `name`, `text` and similar are forbidden; `kind` is allowed. The client list of names is pinned exactly. `CORE_ACTION_EVENTS` is railed. | `J/lib/notebookTelemetry.js:35-51,59-77,79-82,85-158`; `tests/test_notebook_telemetry_events.py:29-89,223-232,303`; `notebookTelemetry.test.js:20-28,93-124` |
| F8 | `createNoteViaApi` (eager) sends `styleId`/`kindId` and is the one door for KindSection, the From-a-style caret, plan create and follow-up create. `StyleHost.finish` handles a switch or an update. `createJournalStyle` is the one create call for the editor, duplicate and save-from-note. `insertWidgetEmbed` is the one insert command for slash blocks. | `J/lib/noteCreation.js:30,44-45,55-61`; `StyleHost.jsx:69-87`; `J/lib/journalStyles.js:80-82`; `J/lib/widgetEmbedNode.jsx:177` |
| F9 | The firm outline seed is `INSERT OR IGNORE` by `seed_key`, guarded only by a unique partial index. The `v` in the JSON is never read. A count rail requires 4-6 outline seeds. Style payloads follow `style_payload`: built-in `kindId`, blocks in `KNOWN_BLOCKS`, no `builtin:note_kind`, a gallery-safe outline, at most 200,000 bytes. | `S/template_gallery.py:98,151,183,223,228-245`, P3a `:671-720`; `tests/test_notebook_template_gallery.py:486-506` |
| F10 | Nothing records a first use of styles. A new preference key needs a `_PREFERENCE_KEYS` row in the same commit as its client writer (the client-writer rail). The `notebook_getting_started` `{v:1, state, at}` blob is the precedent. | `api/routers/auth.py:2820+,2870`; `tests/test_preference_key_validation.py:69-156` |
| F11 | `tourRegistry.js` and the track files are in the first-open closure; NotebookTab and Layout import `OTHER_TOURS`. A `data-tour` attribute added to an eager file costs bytes. `notebookTelemetry.js` is first-open. | `NotebookTab.jsx:85`; `Layout.jsx:12` |
| F12 | Built-in kinds: `trade_plan`, `daily_prep`, `weekend_prep`, `earnings`, `earnings_followup`, `post_trade_review`, `weekly_review`, `thesis`, `watchlist_note`. P3a's `TRADING_STYLES` are `swing, day, prop, options, earnings, long_term`. | `S/note_kinds.py`; P3a `template_gallery.py:75-76` |

## Rulings (each also in the ledger and the PR body)

**R-P5-1. The switch.**
- `NOTEBOOK_STARTER_PACKS_ENABLED` gates three things: the offer, the install endpoint, and the 15 firm style rows becoming visible.
- The rows are seeded on boot regardless of the switch, but `list_gallery` hides firm style rows while BOTH this switch and the library switch are off.
- The tours, the capability lines and the events ride the switches of the surfaces they describe: `notebook_journal_styles_enabled` and `notebook_style_library_enabled`.
- Why: the rows must exist before an owner flips the switch, and a tour for an unarmed surface must stay hidden.
- Cost if wrong: one more flag check.

**R-P5-2. A pack is installed by service, not by route.**
- The install endpoint calls `adopt_style` (P3a) per firm row inside one transaction.
- It needs `NOTEBOOK_STARTER_PACKS_ENABLED` and `NOTEBOOK_JOURNAL_STYLES_ENABLED`. It does NOT need the library switch.
- Each adopted copy carries `source_gallery_id`/`source_version` like any adopt. The member can edit it, and "Notify me" is off.
- Rate: 10 per hour plus 5 per day per member. The endpoint is idempotent: re-installing a pack adds nothing.
- Why: firm picks are the team's, not community content, so they should not wait on the library.
- Cost if wrong: none found.

**R-P5-3. Pack contents** (the seed file holds exactly these 15 rows):

| Pack | Style 1 | Style 2 | Style 3 |
|---|---|---|---|
| Swing | Swing trade plan (`trade_plan`) | Weekend prep (`weekend_prep`) | Swing trade review (`post_trade_review`) |
| Day | Day trading prep (`daily_prep`) | Intraday trade plan (`trade_plan`) | Day trade review (`post_trade_review`) |
| Prop | Prop desk daily prep (`daily_prep`) | Prop trade plan (`trade_plan`) | Prop weekly review (`weekly_review`) |
| Options | Options trade plan (`trade_plan`) | Options earnings prep (`earnings`) | Options trade review (`post_trade_review`) |
| Earnings | Earnings prep (`earnings`) | Earnings follow-up (`earnings_followup`) | Earnings watchlist (`watchlist_note`) |

Blocks and settings per style are in Task 3's table. Each style also gets an outline of headings, so "How do you trade?" lands the member in a note that already reads like a trader's notebook.
- Why: the spec says "3-4 firm styles (UCT picks)". Three per pack keeps the first install small.
- Cost if wrong: the owner swaps a row; see R-P5-4.

**R-P5-4. Seed versioning is by `seed_key`.**
- Each row's key is `uct-style-<pack>-<slug>-v1`.
- To change a shipped firm style, add a `-v2` row and retire the `-v1` row (`status='hidden'`) in the same commit. A one-shot migration keyed on the old seed_key does the retiring.
- There is no in-place upsert.
- Why: an in-place rewrite would race members who already adopted it. Adopted copies are the member's own, and `list_updates` (P3a) only follows community `version`.
- Cost if wrong: a changed pick appears as a new row.

**R-P5-5. When the offer shows.**
- It shows when ALL of these hold:
  - the switch is on;
  - the member has zero styles of their own;
  - `notebook_starter_pack` is unset.
- It appears at the top of `KindSection` ("Start from a kind of note") and in the Styles manager's empty state.
- Choosing a pack writes `{v:1, state:'installed', pack, at}`. "Not now" writes `{v:1, state:'dismissed', at}`.
- The Styles manager always keeps a quiet "Starter packs" link, so the member can still choose a pack after dismissing the offer.
- Why: "first use of styles" (spec). A dismissed offer must not come back unasked.
- Cost if wrong: a member who wants a second pack uses the link.

**R-P5-6. Learn groups.**
- Both tours go in `'Writing and capture'`.
- The spec's "Basics · Trading · Research · Capture" became `LEARN_GROUPS` in code. The code is current and the spec line is not.
- Cost if wrong: one `GROUP_OF` row.

**R-P5-7. Tours start where the member can act.**
- **Journal styles** (flag `notebook_journal_styles_enabled`, start `/journal/notebook`), 4 steps:
  1. the list-header Styles button (a new `data-tour="styles-button"` in NotebookTab.jsx, eager), with `waitFor: 'styles-manager'`;
  2. the manager's heading (`styles-manager`, in StylesManager.jsx);
  3. the kind list (`styles-kinds`);
  4. the "New style" button (`styles-new`).
- **Community library** (flag `notebook_style_library_enabled`, start `/journal/notebook?view=all`), 4 steps:
  1. the existing `templates` anchor, with `waitFor: 'template-gallery-door'`;
  2. the existing `template-gallery-door`;
  3. the library's type chips (`library-types`, in TemplateGallery.jsx, lazy);
  4. an item's Adopt button (`library-adopt`).
- Why: a tour cannot open a closed dialog (F3), so the member's own click opens it.
- Cost if wrong: one more step.

**R-P5-8. What each event carries.**
- **`style_applied`** has one prop: `via`, one of `'new_note' | 'switch' | 'update'`.
  - It is fired from `createNoteViaApi` after `res.ok` when the request carried `styleId` or `kindId`, with `via: 'new_note'`.
  - It is fired from `StyleHost.finish` with `'switch'` or `'update'`, according to `plan.switching`.
- **`style_created`** has one prop: `via`, one of `'editor' | 'duplicate' | 'from_note'`.
  - It is fired in `createJournalStyle` after success.
  - The caller passes `via`. A missing value is sanitized to `'other'`.
- **`block_used`** has one prop: `kind`, a `oneOf` over the 12 `BLOCK_KINDS` ids written as literals.
  - A client rail pins it against `journalBlocks.BLOCK_KINDS`, and a server rail pins it against `journal_styles.BLOCK_KINDS`.
  - It is fired in `insertWidgetEmbed` when `WIDGET_REGISTRY[widgetId]?.block === true`.
  - Blocks composed on the server at create time are not counted.
- None of the three is a `CORE_ACTION_EVENTS` member.
- Why: the spec's "no note content, ever". A closed enum per prop, so nothing a member typed can travel.
- Cost if wrong: a `via` the code does not yet distinguish reads as `'other'`.

**R-P5-9. Announcement and featured style are text, not automation.**
- Task 9 writes `docs/notebook/p5-announcement-draft.md` and `docs/notebook/featured-style-runbook.md`. The owner posts.
- Nothing posts automatically, and no Discord job is added.
- Why: the spec says so ("no automated test posts").

**R-P5-10. Bytes.**
- The first-open closure grows by at most **+1,500 B** over the base measured in Task 1. That covers two thin tour entries plus one `data-tour` attribute in NotebookTab.jsx, three event names and schemas, and one `FLAG_FALLBACKS` row.
- The budget file is never raised.
- With PR #373 merged, headroom is about 25 KB. Task 1 V12 confirms it, and Task 1 stops if headroom is under 2,000 B.

## Global Constraints

P3a's Global Constraints apply, with:
- `$WT = C:\Users\Patrick\uct-worktrees\notebook-p5`.
- Copy everywhere: no em dash, no en dash, no `!`. Tour copy follows the per-track rail's rules.
- Telemetry carries no note content. Every prop is a closed enum.
- The firm style seed rows must each pass `style_payload`'s rules (F9) and `sanitize_body` unchanged.
- Commits use the same procedure and trailers as P3a.

## Review Focus

1. **A member who already has their own styles.**
   - Expected: no offer, while the "Starter packs" link still works.
   - Pinned in Task 5, `test_no_offer_for_a_member_with_styles`.
2. **Installing the same pack twice, or two packs sharing a kind.**
   - Expected: the second install of a pack adds nothing. Two packs both get their own copy of their own rows, because the rows are distinct.
   - Pinned in Task 4, `test_reinstall_adds_nothing`.
3. **A firm style row whose kind or block a future release removes.**
   - Expected: install skips that row, says so in the response (`skipped: [title]`), and installs the rest.
   - Pinned in Task 4, `test_an_unbuildable_firm_row_is_skipped_not_fatal`.
4. **A free-text `kind` or `via` from a stale or crafted client.**
   - Expected: the server sanitizes it to `'other'` and the request is 200.
   - Pinned in Task 6, `test_unknown_kind_is_other`.
5. **A reboot after an admin hid a firm style.**
   - Expected: it stays hidden, because the seed is INSERT OR IGNORE.
   - Pinned in Task 3, `test_reboot_keeps_an_admin_hide`.
6. **The Journal styles tour started on a phone.**
   - Expected: the Styles button anchor is on screen. If the list header hides it on a phone, the tour declares a phone path (Task 1 V8 decides).
   - Pinned in Task 7, `b4Styles.steps.test.js`.

---

## File map

`J` = `app/src/pages/journal-2-0`, `ON` = `J/components/notebook/onboarding`, `S` = `api/services/journal_two`.

| File | Responsibility | Tasks |
|---|---|---|
| `docs/notebook/p5-verify-before-building.md` + evidence | Citations re-read, bytes measured | 1 |
| auth.py `NOTEBOOK_FLAGS`, `notebookFlags.js`, `J/lib/starterPacksFlag.js` (new) + test, the flag tests, `docs/feature_flags.json`, `tools/notebook_switch_rehearsal.py`, `tools/notebook_contract_fixtures.py` | The switch | 2 |
| `S/template_gallery_style_seed.json` (new), `S/template_gallery.py` (`seed_firm_styles`, firm-style visibility), `tests/test_firm_style_seed.py` (new) | The 15 firm styles | 3 |
| `S/starter_packs.py` (new), a route in `api/routers/notebook_journal_styles.py`, auth.py `_PREFERENCE_KEYS` (`notebook_starter_pack`), `tests/test_starter_packs.py` (new) | Install and the seen state | 4 |
| `J/components/notebook/styles/StarterPackOffer.jsx` (new, lazy) + CSS + test, `KindSection.jsx`, `StylesManager.jsx`, `J/lib/starterPacks.js` (new, lazy) | The offer | 5 |
| `J/lib/notebookTelemetry.js`, `api/routers/journal_two.py`, `api/routers/client_errors.py` (admin list), `J/lib/noteCreation.js`, `StyleHost.jsx`, `J/lib/journalStyles.js` (+ callers' `via`), `J/lib/widgetEmbedNode.jsx`, the telemetry rails | The three events | 6 |
| `ON/tours/b4Styles.js` (new), `ON/tours/b4Styles.steps.js` (new), `ON/tours/b4Styles.test.jsx` (new), `ON/tours/index.js`, `ON/learnTours.js`, `data-tour` attributes in `NotebookTab.jsx` / `StylesManager.jsx` / `TemplateGallery.jsx`, the count rails, `ROUTE_OF_FILE` | Two tours | 7 |
| `ON/capabilityList.js` | Two capability lines | 8 |
| `docs/notebook/p5-announcement-draft.md`, `docs/notebook/featured-style-runbook.md` | Owner text | 9 |
| a11y population, `tools/notebook_p5_walk.py` (new), evidence | a11y, walk, bytes | 10 |
| `docs/notebook/p5-arming.md`, PR | Gate, review, PR, arming | 11 |

---

### Task 1: Verify before building

**Files:** Create `docs/notebook/p5-verify-before-building.md` and `docs/notebook/evidence/p5-verify-<run-id>/`.

- [ ] **Step 1: Make the worktree.** Branch `notebook-p5-launch` from `origin/master`. Then create the owner file, check the shared install still has 377 entries, and add the junction. Use the commands in P2 Tier 3's Task 1 Step 1 with the name `notebook-p5`. Confirm that P3a's merge, P4a's merge and #373 are ancestors (`git merge-base --is-ancestor`). Stop if any is not.
- [ ] **Step 2: Record the base reds.** Run each of these files in its own call:
  - every file named in Facts F1-F11's rails;
  - `notebookTelemetry.test.js`;
  - `capabilityList.test.js`;
  - `tests/test_notebook_telemetry_events.py`;
  - `tests/test_j2_telemetry_allowlist.py`;
  - `tests/test_notebook_template_gallery.py`;
  - `tests/test_style_library.py`;
  - `tests/test_preference_key_validation.py`;
  - the flag tests;
  - `reachable.test.js`;
  - `tapFloor.test.js`.
- [ ] **Step 3: Answer V1-V12, quoting a line for each.**
  - **V1:** the base SHA and the three ancestor checks.
  - **V2-V7:** re-read F1-F12, quoting each line and noting any drift.
  - **V8:** is the list-header Styles button (`NotebookTab.jsx:2509-2514` at map time) visible at 390 px, or behind a menu? Read its CSS and any phone branch.
    - If it is hidden on a phone, decide where the tour's step 1 anchors on a phone and record it. Use the `b1ImageDocx` phone-anchor precedent (`b1ImageDocx.steps.js:14-20`).
  - **V9:** P3a's `adopt_style` signature and what it returns. Can it be called inside a caller's transaction (`conn` param)?
  - **V10:** P3a's `list_gallery` firm-row handling. Where does a firm style row become visible, and how does it interact with `_library_hides`?
  - **V11:** P4a's merge. Confirm nothing in P5's eager edits collides with P4a's `TodaySurface`.
  - **V12 (measured):** the first-open closure and headroom.
- [ ] **Step 4: Commit the doc and raw output, then push.** Message: `docs(notebook): P5 verify-before-building (V1-V12, bytes measured)`.

---

### Task 2: The `NOTEBOOK_STARTER_PACKS_ENABLED` switch

Use the same file set and steps as P3a Task 2, plus the Task 1 corrections recorded in the P3a ledger:
- the test reset helper is `__resetNotebookFlags`;
- `tools/notebook_switch_rehearsal.py` needs a `NOT_REHEARSED` reason;
- the `_server_gates()` row reads `starter_packs.enabled` once Task 4 defines it, and a lambda until then. Task 4 must swap it.

Values:
- env `NOTEBOOK_STARTER_PACKS_ENABLED`, payload key `notebook_starter_packs_enabled`;
- helper `J/lib/starterPacksFlag.js` exporting `STARTER_PACKS_FLAG` and `starterPacksEnabled()`;
- ledger label `Notebook: starter packs` (at most 60 characters);
- ledger note: "P5. Gates the How do you trade? offer, the starter-pack install endpoint and the firm style rows in the library. Needs NOTEBOOK_JOURNAL_STYLES_ENABLED. Arm: railway variables --service web --set NOTEBOOK_STARTER_PACKS_ENABLED=1 (the owner's). Rollback: 0; installed copies stay the member's own."

Commit message: `feat(notebook): NOTEBOOK_STARTER_PACKS_ENABLED switch, dark (P5)`.

---

### Task 3: The 15 firm styles

**Files:** Create `S/template_gallery_style_seed.json` and `tests/test_firm_style_seed.py`. Modify `S/template_gallery.py`.

**The seed file shape:**
```json
{"v": 1, "styles": [
  {"seedKey": "uct-style-swing-trade-plan-v1", "pack": "swing", "title": "Swing trade plan",
   "description": "A swing entry with the checklist, sizing and the market at entry.",
   "kindId": "trade_plan",
   "blocks": [{"block": "preEntryChecklist", "enabled": true, "settings": {"includeRules": "yes", "requireAll": "no"}}],
   "outlineHeadings": ["Thesis", "Entry trigger", "Stop and invalidation", "Targets", "What would make me wrong"],
   "properties": {}}
]}
```

`outlineHeadings` becomes the outline body when the file is loaded: one `heading` (level 2) followed by an empty `paragraph` per heading. The JSON therefore never holds TipTap JSON, and the conversion is one function, `_outline_from_headings(headings)`.

**The 15 rows.** Block ids and settings must be from `KNOWN_BLOCKS` and `BLOCK_KINDS`. Every row also has `enabled: true`.

| seedKey slug | kind | blocks (settings) | outlineHeadings |
|---|---|---|---|
| swing-trade-plan | trade_plan | preEntryChecklist (includeRules yes, requireAll no) · positionSizing (grade A) · marketcontext (fields all) · chart (tf D) | Thesis · Entry trigger · Stop and invalidation · Targets · What would make me wrong |
| swing-weekend-prep | weekend_prep | prepMovers · prepLevels · myRules (which active) · marketcontext (fields regime) | Market read · Leaders and themes · Names to watch · Plan for the week |
| swing-trade-review | post_trade_review | tradeReview · myRules (which active) | What I planned · What I did · What I would do differently |
| day-daily-prep | daily_prep | prepWire · prepEarnings · prepMovers · prepLevels · myRules (which active) | Overnight and premarket · Levels that matter · A plus setups · Risk for today |
| day-trade-plan | trade_plan | preEntryChecklist (includeRules yes, requireAll yes) · positionSizing (grade A) · priceStamps (on yes) · chart (tf 5) | Setup · Trigger · Stop · Scale out |
| day-trade-review | post_trade_review | tradeReview · myRules (which active) | Entry quality · Exit quality · Rule followed or broken |
| prop-daily-prep | daily_prep | myRules (which all) · prepWire · prepLevels | Daily loss limit · Focus list · Rules I will not break |
| prop-trade-plan | trade_plan | preEntryChecklist (includeRules yes, requireAll yes) · positionSizing (grade A) · chart (tf 15) | Setup · Size and risk in dollars · Stop · Exit plan |
| prop-weekly-review | weekly_review | myRules (which all) | Rules kept · Rules broken · One change for next week |
| options-trade-plan | trade_plan | preEntryChecklist (includeRules yes, requireAll no) · marketcontext (fields all) · chart (tf D) | Thesis · Contract and expiry · Max loss · Exit plan |
| options-earnings-prep | earnings | prepEarnings · marketcontext (fields indexes) · chart (tf D) | Expected move · Position and risk · Plan for the reaction |
| options-trade-review | post_trade_review | tradeReview | What I expected · What the contract did · What I would do differently |
| earnings-prep | earnings | prepEarnings · chart (tf D) · marketcontext (fields regime) | The setup into the report · What a beat needs · Plan for each reaction |
| earnings-followup | earnings_followup | chart (tf D) | What I expected · What happened · What I learned |
| earnings-watchlist | watchlist_note | chart (tf W) · prepLevels | Why it is on the list · Levels · What would make me act |

Titles and descriptions:
- Title = the R-P5-3 name.
- Description: one sentence of at most 140 characters, in plain words, with no em dash and no `!`. Write it from the blocks.

**`seed_firm_styles(conn)`:**
- It is called right after `seed_firm_templates` in `ensure_gallery_schema`, inside the same `try/except` that only logs.
- It inserts with `INSERT OR IGNORE`, setting `kind='firm'`, `status='approved'`, `featured=1`, `item_type='style'` and `trading_style=<pack>`.
- `payload_json` is built with P3a's own payload shape (`{kindId, outlineBodyJson, blocks, properties}`), `version=1`, `body_json` = the outline, and `preview_json = preview_lines(outline)`.
- It does NOT add these rows to `load_seed()`, so the outline count rail stays at 4-6.

**Visibility (R-P5-1).** In `list_gallery` and `_library_hides`, a firm style row is hidden unless `starter_packs.enabled() or library_enabled()`.

- [ ] **Step 1: Write the failing tests** (`tests/test_firm_style_seed.py`, using P3a's emptied-table fixture pattern):
  1. Fifteen rows: three per pack, five packs, with seed_keys unique.
  2. Every row passes P3a `style_payload`'s rules. Run each through the same validators: the kind is built in, every block is in `KNOWN_BLOCKS`, no `builtin:note_kind`, and the size cap holds.
  3. Every outline passes `sanitize_body` unchanged.
  4. Every description is at most 140 characters, with no em dash, en dash or `!`.
  5. `test_reboot_keeps_an_admin_hide`: seed, hide one row, call `ensure_gallery_schema` again, and the row is still hidden with the count unchanged.
  6. With both switches off, `list_gallery` shows no firm style row and `get_item` answers not-found. With either switch on, they show.
  7. The outline seed count rail (`test_notebook_template_gallery.py:486-500`) is still green.
  8. `_outline_from_headings(['A','B'])` returns exactly `[heading A, empty paragraph, heading B, empty paragraph]`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the new file, `tests/test_notebook_template_gallery.py` and `tests/test_style_library.py`.** Mutation-prove case 6 by dropping the switch check, then restore.
- [ ] **Step 5: Commit and push.** Message: `feat(notebook): fifteen firm styles in five starter packs, seeded dark (P5)`.

---

### Task 4: Installing a pack, and the seen state

**Files:** Create `S/starter_packs.py` and `tests/test_starter_packs.py`. Modify `api/routers/notebook_journal_styles.py` and `api/routers/auth.py`.

**Interfaces:**
```python
PACKS = ("swing", "day", "prop", "options", "earnings")   # ⛔ ONE FACT IN TWO FILES with J/lib/starterPacks.js PACKS
def enabled() -> bool                  # NOTEBOOK_STARTER_PACKS_ENABLED and journal styles
def install(conn, user_id: str, pack: str) -> dict
    # {"installed": [{"styleId", "title"}], "alreadyHad": [title], "skipped": [title]}
```
- **Route:** `POST /api/j2/journal-styles/starter-packs/{pack}`.
  - A router dependency answers the one 404 while `enabled()` is false. It runs BEFORE `require_paid`, which is P3a's R-T4-2 shape.
  - Then `require_paid`.
  - Rate per R-P5-2, with the daily count given back on a refusal.
  - An unknown pack answers 404.
- **`install`** reads the firm style rows for `trading_style=pack` in seed order and calls P3a's `adopt_style` for each (the V9 signature), inside one transaction.
  - A row the member already adopted (`source_gallery_id` match) goes into `alreadyHad`.
  - A row whose adopt raises because a kind or block is unknown goes into `skipped`, and the rest continue.
  - Notify is off.
- **`_PREFERENCE_KEYS`** gets `notebook_starter_pack` with a named validator. The blob is `{v:1, state:'installed'|'dismissed', pack?, at}`, at most 512 bytes; anything else gets the one 400. The client writer lands in Task 5, so add the key's smallest valid value to the client-writer rail's `shaped` dict now (the P4a Task 3 precedent).
- **Swap the Task 2 lambda** for `starter_packs.enabled`.

- [ ] **Step 1: Write the failing tests:**
  1. Installing swing creates three styles owned by the member, each with `source_gallery_id` set.
  2. `test_reinstall_adds_nothing`: a second install puts all three in `alreadyHad`.
  3. Day after swing installs day's three as well.
  4. `test_an_unbuildable_firm_row_is_skipped_not_fatal`: corrupt one row's kindId in the test DB; the result is two installed and one skipped.
  5. While the switch is off, every caller (paid, unpaid and signed out) gets the identical 404.
  6. With the switch on, unpaid gets 402.
  7. An unknown pack is a 404.
  8. The library switch has no effect on install.
  9. The preference validator accepts the two valid shapes, and refuses others and anything over 512 bytes.
  10. Client `PACKS` equals server `PACKS`, parsed from the JS.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them**, plus `tests/test_preference_key_validation.py`, `tests/test_style_library.py` and the flag-parse rail. Mutation-prove case 2 by dropping the already-adopted check.
- [ ] **Step 5: Commit and push.** Message: `feat(notebook): install a starter pack - three firm styles, idempotent, dark (P5)`.

---

### Task 5: "How do you trade?"

**Files:**
- Create: `J/components/notebook/styles/StarterPackOffer.jsx` (+ CSS + test) and `J/lib/starterPacks.js`. Both are lazy-only.
- Modify: `KindSection.jsx`, `StylesManager.jsx`.

**`J/lib/starterPacks.js` exports:**
- `PACKS = Object.freeze([{key:'swing',label:'Swing'},{key:'day',label:'Day'},{key:'prop',label:'Prop'},{key:'options',label:'Options'},{key:'earnings',label:'Earnings'}])`;
- `installStarterPack(pack)` (POST);
- `readStarterPackState(prefs)` and `writeStarterPackState(...)` (setPrefMerged).

**`StarterPackOffer`:**
- A card titled `How do you trade?`.
- One line: `Pick one and we will add three styles you can change.`
- Five buttons (the pack labels), each `≥44 px` on touch, and a `Not now` button.
- Choosing a pack:
  - installs it;
  - writes `state:'installed'`;
  - then shows `Added: <titles>. They are in your Styles.`, plus `Already had: …` and `Skipped: …` lines when those are non-empty.
- On failure it shows `Couldn't add that pack. Nothing was changed.`
- `Not now` writes `state:'dismissed'` and hides the card.

**Where it shows:**
- At the top of `KindSection` when R-P5-5 holds.
- In the Styles manager's empty state.
- A `Starter packs` link in the Styles manager footer opens the same offer whenever the switch is on, whatever the preference says.

- [ ] **Step 1: Write the failing tests:**
  1. The switch is off, so there is no card and no link.
  2. `test_no_offer_for_a_member_with_styles`: the member has one own style, so there is no card, and the link still opens it.
  3. With zero styles and no preference, the card shows in `KindSection`.
  4. Choosing Swing posts once, writes the installed state, and shows the added titles.
  5. `Not now` writes the dismissed state and the card does not come back on rerender.
  6. A failed install shows the failure sentence and writes no state.
  7. Every button has a name, and tab order follows reading order.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them**, plus `tapFloor`, `reachable`, `keyListenerCensus` and the client-writer rail.
- [ ] **Step 5: Commit and push.** Message: `feat(notebook): How do you trade? - the starter pack offer (P5)`.

---

### Task 6: The three events

**Files:**
- Modify: `J/lib/notebookTelemetry.js`, `api/routers/journal_two.py`, `api/routers/client_errors.py` (if its list is separate), `J/lib/noteCreation.js`, `StyleHost.jsx`, `J/lib/journalStyles.js`, the three `createJournalStyle` callers (`StyleEditor.jsx`, `StylesManager.jsx`, `SaveAsStyleForm.jsx`), `J/lib/widgetEmbedNode.jsx`.
- Tests: `notebookTelemetry.test.js`, `tests/test_notebook_telemetry_events.py`, plus a test per call site.

**Interfaces (literal `oneOf` strings; F7):**
```js
STYLE_APPLIED: 'style_applied', STYLE_CREATED: 'style_created', BLOCK_USED: 'block_used',
style_applied: { via: oneOf('new_note', 'switch', 'update') },
style_created: { via: oneOf('editor', 'duplicate', 'from_note') },
block_used: { kind: oneOf(<the 12 BLOCK_KINDS ids, literally, in BLOCK_KINDS order>) },
```
- `createJournalStyle(body, { via })` takes the `via` and fires after success.
- `insertWidgetEmbed` fires `block_used` only when `WIDGET_REGISTRY[widgetId]?.block === true`. It reads the eager registry, never `journalBlocks.js` (F8).

- [ ] **Step 1: Write the failing tests:**
  - **Client:**
    - The exact name list now has 18 names; edit the pinned list.
    - The `block_used.kind` values equal `BLOCK_KINDS.map(k => k.id)`, so nothing else can be sent.
    - `createNoteViaApi` with a styleId fires `style_applied {via:'new_note'}` once after ok and never on failure.
    - `StyleHost.finish` fires `'switch'` and `'update'` per `plan.switching`.
    - Each of the three `createJournalStyle` callers sends its `via`.
    - A slash insert of `positionSizing` fires `block_used {kind:'positionSizing'}`.
    - A `/chart` insert of a non-block widget fires nothing.
  - **Server:**
    - The schema parity rail is green.
    - `block_used.kind` equals `journal_styles.BLOCK_KINDS` ids (a new parity assertion).
    - `test_unknown_kind_is_other`: posting `block_used {kind:'free text'}` is 200 and stored as `'other'`.
    - The admin count endpoint lists all three.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them**, plus `tests/test_j2_telemetry_allowlist.py`, `S/test_telemetry.py`, `reachable`, and the bytes check (build plus `notebook_perf_budgets.py`). Record the bytes delta.
- [ ] **Step 5: Commit and push.** Message: `feat(notebook): style_applied, style_created and block_used telemetry - closed enums, no content (P5)`.

---

### Task 7: Two tours

**Files:**
- Create: `ON/tours/b4Styles.js`, `ON/tours/b4Styles.steps.js`, `ON/tours/b4Styles.test.jsx`.
- Modify: `ON/tours/index.js` (one import, one spread), `ON/learnTours.js` (two `GROUP_OF` rows), and the count rails (21→23, 20→22).
- Add `ROUTE_OF_FILE` entries for `styles/StylesManager.jsx` and `TemplateGallery.jsx` (`() => false`).
- Add the `data-tour` attributes from R-P5-7: one in NotebookTab.jsx and the rest in lazy files.

**Steps and copy** follow R-P5-7. Each step has a title and a body of one or two plain sentences. If Task 1 V8 found the Styles button hidden on a phone, add the phone anchor V8 recorded.

- [ ] **Step 1: Write the failing tests.** `b4Styles.test.jsx` follows the shape of `b1Core.test.jsx:24-93`: ids, flags, 3-6 steps, no em dash, en dash or `!`. Then edit the count rails.
- [ ] **Step 2: Run** `tourAnchors.test.js`, `tourRegistry.test.js`, `learnTours.test.js`, `tourReachability.test.jsx`, `tourEligibility.realRegistry.test.js` and the new file, and see them fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them all green**, plus the bytes check.
- [ ] **Step 5: Commit and push.** Message: `feat(notebook): Journal styles and Community library tours in the Learn menu (P5)`.

---

### Task 8: "See what it can do"

**Files:** Modify `ON/capabilityList.js`.

Add the two entries. Each line is at most 120 characters, with no em dash and no `!`.
```js
{ id: 'journal-styles', flag: 'notebook_journal_styles_enabled', label: 'Journal styles',
  line: 'Pick a kind of note and a style, and every new note starts with your checklist, sizing and outline.' },
{ id: 'style-library', flag: 'notebook_style_library_enabled', label: 'Community library',
  line: 'Browse styles other traders share, adopt one in a click, and get a note when the author improves it.' },
```
- [ ] Run `capabilityList.test.js`, `CapabilityPreview.test.jsx` and `ResearchHome.welcome.test.jsx`. Commit and push with message `feat(notebook): styles and the library in See what it can do (P5)`.

---

### Task 9: Announcement and featured style

**Files:** Create `docs/notebook/p5-announcement-draft.md` and `docs/notebook/featured-style-runbook.md`.

- **The announcement** is under 180 words, in plain words, with no em dash and no `!`. It names:
  - kinds of note and styles;
  - blocks (checklist, sizing, market context, prep pack);
  - the community library (adopt, update notices);
  - starter packs;
  - where to start: New note, then From a style, or the Learn menu.

  It makes no performance claims and gives no numbers about members.
- **The runbook** is the owner's weekly steps:
  1. Open the admin queue.
  2. Pick one approved community style.
  3. Mark it a UCT pick (the existing featured control).
  4. Post the provided two-line template in the owner's chosen channel.

  It states that nothing posts automatically.
- [ ] Commit and push with message `docs(notebook): P5 announcement draft and featured style runbook`.

---

### Task 10: Accessibility, the walk, bytes

- [ ] **Step 1:** Add an axe recipe for `StarterPackOffer` and run it with the coverage rail.
- [ ] **Step 2:** Write `tools/notebook_p5_walk.py` in the shape of the P3a walk. The sandbox env has the journal styles, library and starter packs switches on. The walk:
  1. A fresh paid account opens New note, then From a style, and sees How do you trade?
  2. It picks Swing and sees three styles added.
  3. It creates a note from "Swing trade plan". Its blocks and outline headings render.
  4. It reloads; the offer is gone and the Styles manager's Starter packs link works.
  5. It runs the Journal styles tour from the Learn menu through all steps.
  6. It runs the Community library tour, opening the gallery when asked.
  7. It reads the admin telemetry count and finds `style_applied` ≥ 1.

  Run it at 1280, 820 and 390. Commit the raw output first.
- [ ] **Step 3:** Bytes must be at most V12 + 1,500 B. Commit the raw output.
- [ ] **Step 4:** Commit and push with message `test(notebook): P5 a11y, walk and bytes evidence`.

---

### Task 11: Gate, review, PR, arming

Same as P3a Task 12. The arming packet is `docs/notebook/p5-arming.md`, and it checks:
- the payload key;
- the smoke account sees the offer, installs Swing, then deletes the three styles through the product;
- the tours appear in the Learn menu;
- the capability lines show.

The owner posts the announcement after arming. That is not this task's.

---

## Self-review (done at write time)

1. **Spec coverage, P5 items 1-5:**
   - Starter packs: Tasks 3-5.
   - Tours with phone anchors: Task 7, plus Task 1 V8.
   - "See what it can do": Task 8.
   - Announcement and featured pick: Task 9.
   - Measurement: Task 6. `style_adopted` and `library_viewed` came with P3a Task 11, and Task 1 verifies them.
   - §6: bytes (R-P5-10), a11y (Tasks 5 and 10), privacy (closed enums, R-P5-8), rollback (the switch), and the ONE-FACT pairs (PACKS, and block kinds in telemetry).
2. **Placeholders:** none. Tour step copy is written in Task 7 from R-P5-7's anchors under the per-track rail. Descriptions are written in Task 3 under a tested length and character rule. Both are content governed by tests, not open design.
3. **Names used the same everywhere:** `NOTEBOOK_STARTER_PACKS_ENABLED`, `starterPacksEnabled`, `starter_packs.enabled`, `PACKS`, `install`, `seed_firm_styles`, `_outline_from_headings`, `notebook_starter_pack`, `StarterPackOffer`, `b4Styles`, `style_applied`, `style_created`, `block_used`.
4. **Review Focus:** each line has its named test.
