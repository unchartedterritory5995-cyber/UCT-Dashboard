# Notebook P2 Tier 3: Year Wrapped, Mood Check-in, Checklist from My Winners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three features, all dark behind one switch, `JOURNAL_TIER3_ENABLED`:
1. **A mood and focus check-in block.** It feeds a new "By check-in" view in the Insights psychology section.
2. **"Checklist from my winners".** It suggests before-entry checklist items from tags common to the member's best trades, lists those trades as evidence, and the member accepts each item one at a time.
3. **"Your trading year".** A lazy page of best setups, lessons, most-written tickers and the discipline trend, opened from the Report page.

**Architecture:**
- **The check-in block** is a block like any other: a `widgetEmbed` with its state in `params`, changed only through `useBlockParams`, the one write path.
  - A new note sidecar, `j2_note_checkins`, is rebuilt in `_sync_note_sidecars`, the same walk that already projects embeds (`api/services/journal_two/notes.py:357`). The analytics service can then join check-in days to trades without reading note bodies.
- **The suggestions are read-only.**
  - A new pure service ranks tags over the member's own closed trades.
  - Accepting a suggestion creates a before-entry rule through the existing rules door. The pattern is `MakeRuleButton.jsx`: a pre-filled label, a read-only evidence line, one confirm, one write.
- **Wrapped** is one read endpoint over tables that already exist, plus one lazy page.
- **Bytes.** Only the block costs first-open bytes. The registry is static in the closure, through `widgetEmbedCore.js:6-9`. The suggestions surface and the Wrapped page are lazy.

**Tech Stack:** React + Vite, TipTap node views, vitest + Testing Library, FastAPI, SQLite, pytest, Python Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md`
- §P2 Tier 3, items 13-15 (lines 277-281);
- the block integrity rule (226-232);
- §6 (361-378);
- delivery order: P2 T3 is LAST (line 408).

**Code map:** `C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\61625d99-f8db-4269-a728-231c08d3da11\scratchpad\t3-code-map.md`.

**Model plan for shape and constraints:** `docs/superpowers/plans/2026-10-17-notebook-p3a-style-library.md`.

**Base:** `origin/master` when Task 1 runs.
- Worktree: `C:\Users\Patrick\uct-worktrees\notebook-t3`, branch `notebook-t3`, with a `.uct-session-owner` file.
- ⛔ Task 3 onward needs the byte headroom in Task 1's V12. If the headroom is short, T3 waits for the headroom-freeing PR to land. Whichever of P3a / P4a / T3 lands last merges master and re-measures bytes.

## Rulings (each also in the ledger and the PR body)

**R-T3-1: one switch.**
- **Ruling:** `JOURNAL_TIER3_ENABLED` gates all three features.
  - With it off, the check-in block cannot be created (slash item and style toggle hidden), the "By check-in" view and the suggestions are not shown, and the Wrapped door is hidden.
  - An existing check-in block still renders, because a flag gates creating a block, never rendering it.
- **Why:** each `FLAG_FALLBACKS` row costs first-open bytes, the three ship together, and each one degrades on its own.
- **Cost if wrong:** one feature cannot be darkened alone without a deploy.

**R-T3-2: the check-in block's params.**
- **Ruling:**
  - Params are `{mood: ''|'1'..'5', focus: ''|'1'..'5', day: ''|'YYYY-MM-DD'}`.
  - The words are:

    | Value | Mood | Focus |
    |---|---|---|
    | `1` | Rough | Scattered |
    | `2` | Low | Distracted |
    | `3` | Okay | Steady |
    | `4` | Good | Focused |
    | `5` | Great | Locked in |

  - `day` is the ET date set the first time the member picks a mood or focus. It is never changed afterwards, and it is cleared only when both are cleared.
- **Why:** strings fit the registry's `enum` schema type. `day` makes the check-in mean the day it was made, not the day the note was opened or last saved.
- **Cost if wrong:** a member checking in after midnight ET lands on the next day.

**R-T3-3: the psychology view keys on day, not on note.**
- **Ruling:** a check-in counts for the ET trading day in its `day` param.
  - If one day has several check-ins (two notes), that day's value is the mean, rounded to the nearest whole level.
  - Trades join on `trading_day_et`. A trade with no `trading_day_et` is skipped and counted as `unjoined`.
- **Why:** the psychology views are day- and trade-keyed (`analytics.py:1021`), and a member may check in in a daily note or a trade plan.
- **Cost if wrong:** a two-check-in day is blurred.

**R-T3-4: "tags" means emotion tags.**
- **Ruling:** suggestions come from `emotion_tags` only. Mistake tags are excluded, because a mistake is never a checklist item.
- **Why:** the spec says "tags common to the member's best trades", and `filters.py:69-81` defines tags as mistake plus emotion.
- **Cost if wrong:** none found.

**R-T3-5: what "best trades" means, and when a tag qualifies.**
- **Ruling:** best trades are the top 20 winning closed equity trades by effective R (`_effective_r_map`). Ties break by later exit date.
  - At least 10 winners are needed. Below 10, the surface says `Log at least 10 winning trades and this will suggest checklist items from them.`
  - A tag is suggested when BOTH of these hold:
    - it is on at least 40% of the best trades;
    - its rate among the best is at least 1.5× its rate among all other closed trades. If the tag never appears outside the best, the ratio counts as infinite.
  - At most 5 suggestions are shown, ordered by rate among the best.
  - Each suggestion lists the best trades carrying the tag as evidence: symbol, date, R.
- **Why:** the ratio stops a tag that is on every trade from posing as a winners' habit. The minimum follows `sample_size.py` (n<10 is too few).
- **Cost if wrong:** a suggestion is missed or weak. The member accepts each one, so nothing is written unseen.

**R-T3-6: accepting a suggestion writes ONE before-entry rule.**
- **Ruling:** accepting creates a `j2_journal_rules` row with `before_entry = 1`, through the existing rules create door that `MakeRuleButton` already uses.
  - The label is pre-filled as `Before entry: am I <tag>?` and the member can edit it.
  - The pre-entry checklist already includes before-entry rules (spec item 1), so the item appears there with no new link.
- **Why:** one write, through a door that already exists and is already railed (`rulesApi.js` is the named exception in `blockDoors.test.js`).
- **Cost if wrong:** none found.

**R-T3-7: lessons are the rules the member added or changed that year.**
- **Ruling:** Wrapped's "Lessons" lists `j2_journal_rule_versions` rows whose `changed_at` falls in the year, each with its label, version, `change_note` and date, newest first, at most 12, under the heading "Lessons you wrote into your rules".
  - No text is extracted from notes, and no model call is made.
- **Why:** there is no structured lessons field (code map). A rule change is a lesson the member wrote down, with a date. Mining note prose would be a guess presented as their words.
- **Cost if wrong:** a member whose lessons live only in prose sees "No rule changes this year".

**R-T3-8: when Wrapped is available.**
- **Ruling:** `/journal-2-0/wrapped/:year` is a lazy route.
  - The Report page shows a door `Your <year> in trading`:
    - for the current year from December 1;
    - for any earlier year that has at least one closed trade, always, through a year picker.
  - There is no notice and no scheduled job.
- **Why:** the spec frames it as December. A scheduled mass notice is a write to every member for a dark feature. The Report page is the period-review surface members already use. Today is out, because P4a is editing it in parallel.
- **Cost if wrong:** less discovery in December. P5's tours can add a pointer.

**R-T3-9: Wrapped's four sections, and where each number comes from.**
- **Best setups:** per-setup expectancy R from `playbook_stats` over the year's closed trades, the top 3. Each carries its trade count and the `sample_size` label. A setup with fewer than 10 trades shows `Too few trades to rank`.
- **Most-written tickers:** live notes (`deleted_at IS NULL AND archived_at IS NULL`) created in the year, counted once per note per symbol, over `j2_notes.ticker` ∪ `j2_note_mentions.symbol`. The top 5.
- **Discipline trend:** monthly mean `adherence_pct` from `j2_trade_adherence` for trades closed that month, with each month's trade count. A month with no adherence rows reads `—`, never 0.
- **Lessons:** see R-T3-7.
- **Scope:** every number is scoped to the account picker (`accountId`, or All Accounts).
- **Cost if wrong:** one section's number differs from the Report page. Contract fixtures (Task 9) pin each shape.

## Global Constraints

P3a's Global Constraints apply (`docs/superpowers/plans/2026-10-17-notebook-p3a-style-library.md`, section "Global Constraints"), with these values:

- **Worktree.** `$WT = C:\Users\Patrick\uct-worktrees\notebook-t3`.
- **Block integrity rule (spec 226-232).** The check-in block changes state only through `useBlockParams`. It never writes a note itself, and its server read is none.
- **Schema.** No new node type or attribute; the block is a `widgetEmbed`. If Task 1 finds otherwise, the controller rules before Task 3.
- **Bytes.** The first-open closure grows by at most **+700 B** over the base measured in Task 1. That covers one `FLAG_FALLBACKS` row plus the block's rows in `registry.js`, `journalBlocks.js`, `BLOCK_COMPONENTS` and the slash menu. Everything else is lazy.
- **Typing.** No regression against the busy-time baseline of record. Spec §6 asks for a note holding one of every block. The check-in block joins that note in Task 10's walk.
- **Sample sizes.** Every count- or rate-based number on these surfaces goes through `sample_size.py` / `sampleSize.js`, with n printed.
- **Privacy.** No note text leaves the member's own reads. Wrapped carries counts, symbols and the member's own rule labels.
- **Commits.** Same procedure and trailers as P3a.

## Review Focus

1. **A check-in made just after midnight ET.**
   - Expected: it counts for the new ET day. `day` is set from `todayET()`, not from local time.
   - Pinned in Task 3, `sets day from todayET on the first pick`.
2. **A note with a check-in is trashed, then restored.**
   - Expected: the sidecar drops it on trash and returns it on restore. The psychology view never counts a trashed note.
   - Pinned in Task 4, `test_trash_and_restore_move_the_checkin`.
3. **Two check-ins on one day, mood 2 and mood 5.**
   - Expected: the day reads 4, because the mean 3.5 rounds half up.
   - Pinned in Task 5, `test_two_checkins_one_day_take_the_rounded_mean`.
4. **A member with 9 winning trades.**
   - Expected: the suggestions surface shows the minimum sentence and no suggestion.
   - Pinned in Task 6, `test_fewer_than_ten_winners_suggests_nothing`.
5. **A tag on every trade.**
   - Expected: it is never suggested, because its ratio is 1.0.
   - Pinned in Task 6, `test_a_tag_on_every_trade_is_not_a_winners_habit`.
6. **Wrapped for a year with trades but no adherence rows.**
   - Expected: every month reads `—`, the trend line has no points, and the section says `No adherence recorded this year.`
   - Pinned in Task 7, `test_months_without_adherence_read_none`.

---

## File map

`J` = `app/src/pages/journal-2-0`, `S` = `api/services/journal_two`.

| File | Responsibility | Tasks |
|---|---|---|
| `docs/notebook/t3-verify-before-building.md` and its evidence | citations re-read, bytes measured | 1 |
| `api/routers/auth.py`, `J/lib/offline/notebookFlags.js`, `J/lib/tier3Flag.js` (new) + test, `tests/test_notebook_flags.py`, `tests/test_notebook_flag_parse.py`, `docs/feature_flags.json`, `tools/notebook_contract_fixtures.py` | the switch | 2 |
| `app/src/widgets/registry.js`, `J/lib/journalBlocks.js`, `S/journal_styles.py`, `S/trader_blocks.py`, `J/components/notebook/blocks/BlockNodeView.jsx`, `J/components/notebook/blocks/MoodCheckInBlock.jsx` (new) + test, `J/components/notebook/SlashMenu.jsx`, `S/public_note_payload.py`, `J/a11y/notebookSurfaces.js` | the check-in block | 3 |
| `api/services/journal_two/db.py` (`j2_note_checkins`), `S/notes.py` (`_sync_note_sidecars`, trash/restore), the account purge (`_DIRECT_USER_TABLES`), `tests/test_note_checkins_sidecar.py` (new) | the sidecar | 4 |
| `S/analytics.py` (`_checkin_section`), `J/components/insights/PsychologySection.jsx` (+ a `CheckInOutcomes.jsx` leaf), `tests/test_analytics_checkins.py` (new) | the psychology view | 5 |
| `S/checklist_suggestions.py` (new), a route in `api/routers/journal_two.py`, `J/components/insights/ChecklistFromWinners.jsx` (new) + test, the InsightsHub section key, `tests/test_checklist_suggestions.py` (new) | checklist from my winners | 6 |
| `S/wrapped.py` (new), a route, `tests/test_wrapped.py` (new) | Wrapped data | 7 |
| `J/pages/WrappedPage.jsx` (new, lazy) + CSS + test, `app/src/App.jsx` (lazy route), the Report page door | Wrapped page | 8 |
| `tools/notebook_contract_fixtures.py`, `tests/fixtures/notebook_contract/*` | contract fixtures | 9 |
| a11y population, `tools/journal_tier3_walk.py` (new), evidence | a11y, walk, typing, bytes | 10 |
| `docs/notebook/t3-arming.md`, PR | gate, review, PR, arming | 11 |

---

### Task 1: Verify before building

**Files:** Create `docs/notebook/t3-verify-before-building.md` and `docs/notebook/evidence/t3-verify-<run-id>/`.

- [ ] **Step 1: Make the worktree.** Make it at `C:\Users\Patrick\uct-worktrees\notebook-t3` on branch `notebook-t3` from `origin/master`. Then write the owner file and check that the shared install still holds 377 entries. Then make the junction from PowerShell.
  ```bash
  cd /c/Users/Patrick/uct-dashboard && git fetch origin && git worktree add -b notebook-t3 /c/Users/Patrick/uct-worktrees/notebook-t3 origin/master
  printf 'session: 61625d99-f8db-4269-a728-231c08d3da11\ncreated: 2026-10-17\n' > /c/Users/Patrick/uct-worktrees/notebook-t3/.uct-session-owner
  ls -A /c/Users/Patrick/uct-worktrees/_nb-shared-install/node_modules | wc -l
  ```
  ```powershell
  New-Item -ItemType Junction -Path 'C:\Users\Patrick\uct-worktrees\notebook-t3\app\node_modules' -Target 'C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules'
  ```
- [ ] **Step 2: Record the base reds.**
  - Vitest: `app/src/widgets/registry.test.js`, `J/components/notebook/blocks/*.test.jsx`, `J/lib/blocks/blockDoors.test.js`, `J/components/notebook/SlashMenu*.test.jsx`, `J/components/insights/*.test.jsx`, `J/a11y/traderBlocks.a11y.test.jsx`, `app/src/components/screener/reachable.test.js`, `app/src/styles/tapFloor.test.js`.
  - Pytest: `tests/test_journal_styles_store.py`, `tests/test_trader_blocks*.py`, `tests/test_public_note_payload.py`, `tests/test_journal_two_analytics*.py`, `tests/test_notebook_flags.py`, `tests/test_notebook_flag_parse.py`, `tests/test_notebook_sample_size.py`, and the account purge test.
  - Use the real file names the globs find, and run each file in its own call.
- [ ] **Step 3: Answer V1-V12, each with a quoted line.**

  | V | Question | Where |
  |---|---|---|
  | V1 | Base SHA | git |
  | V2 | `blockManifest` + the block entries; `registry.test.js` S20's parity with `journalBlocks.js` | `app/src/widgets/registry.js:291-305`, `:877-913` |
  | V3 | `BLOCK_KINDS` ⇄ `journal_styles.BLOCK_KINDS`/`KNOWN_BLOCKS` and the Node rail | `J/lib/journalBlocks.js:8`, `S/journal_styles.py:53-79`, `tests/test_journal_styles_store.py:35,48` |
  | V4 | `BLOCK_IDS`, `_node`, `BUILDERS`, `_empty` | `S/trader_blocks.py:23,82,136-162` |
  | V5 | Slash `traderItem` + the Trading group | `J/components/notebook/SlashMenu.jsx:36-44,302-311,349-355` |
  | V6 | The vendor row for a block in the public payload | `S/public_note_payload.py:203-211`, `tests/test_public_note_payload.py:663` |
  | V7 | `_sync_note_sidecars` walk + where trash/restore rebuild or delete sidecars | `S/notes.py:357-500`, `:4370` |
  | V8 | `_psychology_section` signature, and the call site's access to `conn` + `user_id` | `S/analytics.py:150-175,1021` |
  | V9 | `MakeRuleButton` props and the rules create call it makes (endpoint + body, `before_entry` field name) | `J/components/insights/MakeRuleButton.jsx` |
  | V10 | `playbook_stats` per-setup expectancy over a date range; `j2_trade_adherence` columns; `j2_journal_rule_versions` columns | `S/playbook_stats.py`, `S/db.py:1798`, `:388-399` |
  | V11 | The Report page file and where a door fits; InsightsHub section keys; `App.jsx` lazy route idiom for `/journal-2-0/*` | `J/` (search) |
  | V12 (**measured**) | First-open closure on the base after `npm run build`, AND headroom = budget − closure | `python tools/notebook_perf_budgets.py --dist app/dist` |

  If V12's headroom is below 700 B, write "T3 WAITS FOR HEADROOM" at the top of the verify doc and stop after Step 4. The controller rules.
- [ ] **Step 4: Commit the doc and the raw output, and push.** Message: `docs(journal): P2 Tier 3 verify-before-building (V1-V12, bytes measured)`.

---

### Task 2: The `JOURNAL_TIER3_ENABLED` switch

Same file set and steps as P3a Task 2, with these values:
- env `JOURNAL_TIER3_ENABLED`; payload key `journal_tier3_enabled`;
- helper `J/lib/tier3Flag.js` exporting `TIER3_FLAG` and `tier3Enabled()`;
- ledger label "Journal Tier 3 (check-in, checklist from winners, trading year)".

Ledger note: "P2 Tier 3. Gates creating the mood check-in block, the By check-in psychology view, Checklist from my winners and the Your trading year door. Off: none is offered; an existing check-in block still renders. Payload key journal_tier3_enabled. Arm: railway variables --service web --set JOURNAL_TIER3_ENABLED=1 (the owner's). Rollback: 0; check-ins already stored stay stored and unread."

Commit message: `feat(journal): JOURNAL_TIER3_ENABLED switch, dark (P2 T3)`.

---

### Task 3: The mood and focus check-in block

**Files:**
- Modify: `app/src/widgets/registry.js`, `J/lib/journalBlocks.js`, `S/journal_styles.py`, `S/trader_blocks.py`, `J/components/notebook/blocks/BlockNodeView.jsx`, `J/components/notebook/SlashMenu.jsx`, `S/public_note_payload.py`, `J/a11y/notebookSurfaces.js`
- Create: `J/components/notebook/blocks/MoodCheckInBlock.jsx`, `J/components/notebook/blocks/MoodCheckInBlock.test.jsx`, `J/lib/blocks/checkinWords.js`, `J/lib/blocks/checkinWords.test.js`

**Interfaces (produces):**
```js
// registry.js, beside tradeReview:
moodCheckIn: blockManifest('Mood and focus check-in', [
  { key: 'mood', type: 'enum', options: ['', '1', '2', '3', '4', '5'], default: '' },
  { key: 'focus', type: 'enum', options: ['', '1', '2', '3', '4', '5'], default: '' },
  { key: 'day', type: 'string', default: '' },
], '[mood and focus check-in]'),
// journalBlocks.js BLOCK_KINDS, after tradeReview:
Object.freeze({ id: 'moodCheckIn', label: 'Mood and focus check-in', search: '[mood and focus check-in]', settings: Object.freeze([]) }),
// BlockNodeView.jsx BLOCK_COMPONENTS:
moodCheckIn: () => import('./MoodCheckInBlock'),
// J/lib/blocks/checkinWords.js (lazy-only: imported by the block body and the psychology leaf, never by an eager file):
export const MOOD_WORDS = Object.freeze({ 1: 'Rough', 2: 'Low', 3: 'Okay', 4: 'Good', 5: 'Great' })
export const FOCUS_WORDS = Object.freeze({ 1: 'Scattered', 2: 'Distracted', 3: 'Steady', 4: 'Focused', 5: 'Locked in' })
export function nextCheckinParams(params, key, value, today) // pure; R-T3-2's day rule
```

Server side:
- add `"moodCheckIn"` to `trader_blocks.BLOCK_IDS`;
- add `BUILDERS["moodCheckIn"] = _empty("moodCheckIn", {"mood": "", "focus": "", "day": ""})`;
- add the matching row to `journal_styles.BLOCK_KINDS`, in the exact shape V3 records;
- add the vendor row to `public_note_payload.py` in V6's shape. A published note shows the block as its `plainText` line and never the member's mood.

**The block body (`MoodCheckInBlock.jsx`):**
- It renders two rows of five toggle buttons:
  - **Mood:** Rough · Low · Okay · Good · Great
  - **Focus:** Scattered · Distracted · Steady · Focused · Locked in
- Each button is a real `<button>` with `aria-pressed` and a ≥44 px target on touch.
- Pressing a selected button clears it.
- Each press calls `useBlockParams().setParams(nextCheckinParams(params, key, value, todayET()))`. There is one transaction per press and no fetch.
- Under the rows sits one muted line: `Checked in for <Mon D>` once `day` is set, otherwise `Pick how you feel and how focused you are.`
- When the block is not editable (a read-only or published view), it shows the chosen words only, as text.

- [ ] **Step 1: Write the failing tests.**
  - `checkinWords.test.js`:
    1. **Sets day from todayET on the first pick.** `nextCheckinParams({mood:'',focus:'',day:''}, 'mood', '4', '2026-10-17')` → `{mood:'4', focus:'', day:'2026-10-17'}`.
    2. A later pick on another day keeps the first `day`.
    3. Clearing both clears `day`; clearing one keeps it.
    4. The function is pure (frozen input).
  - `MoodCheckInBlock.test.jsx`, with a mocked `useBlockParams`:
    1. Pressing `Good` calls `setParams` once with `mood:'4'`.
    2. Pressing `Good` again clears it.
    3. No `fetch` is ever called. Spy on it.
    4. Read-only mode renders `Mood: Good · Focus: Steady` as text and no buttons.
    5. Every button has an accessible name: `Mood: Good`, `Focus: Steady`.
  - Server, in `tests/test_journal_styles_store.py` (the Node parity rail picks up the row by itself) and in `tests/test_trader_blocks*.py`:
    - `BUILDERS['moodCheckIn']` builds a node whose `searchText` is `[mood and focus check-in]`;
    - its params equal the empty triple.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - Gate creation, never rendering, with `tier3Enabled() && journalStylesEnabled()`:
    - the slash `traderItem` for `moodCheckIn` gets `available: () => tier3Enabled() && journalStylesEnabled()`;
    - the style editor's block toggle hides the kind when the switch is off. Find where the style editor lists `BLOCK_KINDS` (V3), and filter with ONE predicate exported from `tier3Flag.js` (`isTier3Block(id)`), never a copied id list.
  - Add an a11y recipe for the block to the Notebook a11y population, `J/a11y/notebookSurfaces.js:195-200`, beside the other blocks.
- [ ] **Step 4: Run the tests plus these rails:**
  - `registry.test.js`
  - `blockDoors.test.js`
  - `traderBlocks.a11y.test.jsx`
  - `reachable.test.js`
  - `tapFloor.test.js`
  - `test_public_note_payload.py`

  Mutation-prove the parity rail: drop the `focus` row from `journalBlocks.js`, see `test_journal_styles_store.py` fail, then restore and verify against `git cat-file blob HEAD:<path>`.
- [ ] **Step 5: Commit and push.** Message: `feat(journal): mood and focus check-in block (P2 T3)`.

---

### Task 4: The `j2_note_checkins` sidecar

**Files:**
- Modify: `S/db.py`, `S/notes.py`, the account purge module (`_DIRECT_USER_TABLES`, code map P3: `:161-163`)
- Create: `tests/test_note_checkins_sidecar.py`

**Interfaces:**
```sql
CREATE TABLE IF NOT EXISTS j2_note_checkins (
  note_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  embed_id TEXT NOT NULL,
  day TEXT NOT NULL,            -- 'YYYY-MM-DD', the block's day param
  mood INTEGER,                 -- 1..5 or NULL
  focus INTEGER,                -- 1..5 or NULL
  created_at TEXT NOT NULL,
  PRIMARY KEY (note_id, embed_id)
);
CREATE INDEX IF NOT EXISTS idx_j2_note_checkins_user_day ON j2_note_checkins(user_id, day);
```

`_sync_note_sidecars` collects every `widgetEmbed` node with `widgetId == 'moodCheckIn'` in the same walk. The `ntype == "widgetEmbed"` branch already reads `attrs` and `params`. A node is kept only when all three hold:
- `day` matches `^\d{4}-\d{2}-\d{2}$` and is a real date;
- at least one of mood/focus is `'1'..'5'`;
- `embedId` is a non-empty string.

It then runs `DELETE FROM j2_note_checkins WHERE note_id=?` plus an `executemany` insert inside the caller's transaction, the same as `j2_note_mentions` (`notes.py:344-355`).
- Trash, restore and hard delete follow whatever V7 records for `j2_note_mentions`. Every place that deletes or rebuilds mentions does the same for check-ins, and the test proves each.
- A bad param degrades: the node is skipped and the note still saves. This follows `notes.py:388-396`'s philosophy.
- `j2_note_checkins` joins `_DIRECT_USER_TABLES`.

- [ ] **Step 1: Write the failing tests.** Use the fixture pattern the existing sidecar tests use (V7 names one):
  1. Saving a note with one check-in block `{mood:'4', focus:'', day:'2026-10-17'}` → one row: mood 4, focus NULL.
  2. Re-saving with mood cleared and focus `'2'` → the row has mood NULL and focus 2. The table is rebuilt, never duplicated.
  3. A block with `day:''`, or `day:'2026-02-30'`, or both levels empty → no row, and the save returns 200.
  4. **Trash and restore move the check-in.** Trash removes the row, or excludes it; follow V7's rule for mentions and assert the same. Restore brings it back.
  5. Account purge removes the member's rows and no one else's.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the new file plus the existing sidecar, notes and purge tests V7 named.** Mutation-prove case 3: drop the real-date check and see case 3 fail. Then restore the file.
- [ ] **Step 5: Commit and push.** Message: `feat(journal): j2_note_checkins sidecar from the check-in block (P2 T3)`.

---

### Task 5: The "By check-in" psychology view

**Files:**
- Modify: `S/analytics.py`, `J/components/insights/PsychologySection.jsx`
- Create: `J/components/insights/CheckInOutcomes.jsx` (+ CSS + test), `tests/test_analytics_checkins.py`

**Interfaces (produces):**
- `psychology.checkIns` in the analytics payload:
  ```json
  {"checkInDays": int, "joinedTrades": int, "unjoined": int,
   "mood":  [{"level": 1..5, "word": "...", "days": int, "tradeCount": int, "avgPnl": float|null, "winRate": float|null}],
   "focus": [ ...same... ]}
  ```
  - It is built by `_checkin_section(conn, user_id, rows)`.
  - Words come from a Python `MOOD_WORDS` / `FOCUS_WORDS` tuple in `S/analytics.py`. ⛔ This is ONE FACT IN TWO FILES with `checkinWords.js`, so add a Node-parsed parity assertion in `tests/test_analytics_checkins.py`, the same way `test_journal_styles_store.py` reads `journalBlocks.js`.
  - `winRate` and `avgPnl` follow `_psychology_section`'s own definitions: NET P&L, with breakevens excluded from the win-rate denominator.
  - Every level 1..5 is returned, including zero-trade ones, so the client can grey thin samples.
- The check-in rows are read only for this member, `day` between the analytics date range, from live notes only (join `j2_notes` on `deleted_at IS NULL`).
- **`CheckInOutcomes.jsx`:**
  - a two-tab table, `Mood · Focus`, with one row per level;
  - each row shows the word, days, trades, win rate and average P&L;
  - the n shown follows `sampleSize.js`, and rows under 10 trades are greyed with `Too few trades`;
  - empty state: `Add a check-in block to your daily note to see how mood and focus line up with your trading.`
  - It renders only when `tier3Enabled()`.

- [ ] **Step 1: Write the failing tests.**
  - Python, over a seeded member:
    1. **Two check-ins on one day take the rounded mean.** The levels are mood 2 and mood 5, so the day counts as mood 4.
    2. A trade on a day with no check-in is not in any level.
    3. A trade whose `trading_day_et` is NULL counts in `unjoined`.
    4. A trashed note's check-in is ignored.
    5. Another member's check-ins are never read.
    6. The words agree with `checkinWords.js` (the Node parity check).
  - Vitest:
    1. With the switch off, the view is absent.
    2. With it on, the table renders rows from a payload fixture, and the `Too few trades` grey shows below 10.
    3. The empty state sentence renders when `checkInDays == 0`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** In `get_analytics`, the call site (`analytics.py:171`) becomes `"psychology": {**_psychology_section(rows), "checkIns": _checkin_section(conn, user_id, rows)}`. Use the names V8 records. The rest of the psychology payload is untouched.
- [ ] **Step 4: Run the new tests plus every existing analytics test file and `PsychologySection*.test.jsx`.** Mutation-prove case 1: replace the mean with `max` and see the test fail. Then restore.
- [ ] **Step 5: Commit and push.** Message: `feat(journal): mood and focus check-ins in the psychology view (P2 T3)`.

---

### Task 6: Checklist from my winners

**Files:**
- Create: `S/checklist_suggestions.py`, `tests/test_checklist_suggestions.py`, `J/components/insights/ChecklistFromWinners.jsx` (+ CSS + test)
- Modify: `api/routers/journal_two.py` (one GET route), the InsightsHub section list (V11)

**Interfaces (produces):**
```python
MIN_WINNERS = 10
BEST_N = 20
MIN_SHARE = 0.40
MIN_LIFT = 1.5
MAX_SUGGESTIONS = 5
def suggest(conn, user_id: str, account_id: str | None) -> dict:
    """{"status": "ok"|"too_few", "winnerCount": int,
        "suggestions": [{"tag": str, "label": str, "shareBest": float, "shareOthers": float,
                         "evidence": [{"tradeRef": str, "symbol": str, "exitDate": str, "r": float}]}]}"""
```
- Route `GET /api/j2/insights/checklist-suggestions?account_id=` behind `require_paid`. It returns the dict. When the switch is off it returns 404, the same off-shape P3a Task 2 records for a dark route.
- `label` is `Before entry: am I <tag>?`.
- Effective R comes from `analytics._effective_r_map`. Closed equity trades only, honouring `analytics_excluded` exactly as `ANALYTICS_INCLUDED_SQL` does.
- Rules for a tag:
  - A tag already present as a before-entry rule label is dropped. Compare case-insensitively on the tag word inside the label.
  - Evidence is ordered by R, descending.
- **`ChecklistFromWinners.jsx`** (lazy, under Insights):
  - Each suggestion shows the tag, `On 9 of your 20 best trades (45%) · on 12% of the rest`, an evidence list (symbol · date · R) that links each trade to its trade page, and an `Add to my checklist` button.
  - The button opens `MakeRuleButton`'s confirm with the label pre-filled and editable and the evidence line read-only.
  - On success: `Added. It will show in your pre-entry checklist.`, and the suggestion leaves the list.
  - On failure: `Couldn't add that rule. Nothing was changed.`

- [ ] **Step 1: Write the failing tests.**
  - Python, over a seeded book:
    1. **Fewer than ten winners suggests nothing.** 9 winners → `status: 'too_few'` and an empty list.
    2. **A tag on every trade is not a winners' habit.** It is on all 40 trades, so its ratio is 1.0 and it is not suggested.
    3. A tag on 10 of the 20 best and on 1 of the 30 others is suggested, with its evidence of 10 trades.
    4. A mistake tag on 18 of the 20 best is never suggested.
    5. A tag already present as a before-entry rule is not suggested.
    6. `analytics_excluded` trades are ignored.
    7. At most 5 suggestions, ordered by share.
    8. The route returns 404 with the switch off and 402 for an unpaid member (the `require_paid` shape).
  - Vitest:
    1. The `too_few` sentence renders.
    2. A suggestion renders its share line and evidence links.
    3. Accepting calls the rules create door once with `before_entry` true and the edited label.
    4. A failed create shows the failure sentence and keeps the suggestion.
    5. No other write happens. Spy on fetch, and allow only GET plus the one rules POST.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the new tests plus `blockDoors.test.js`, `MakeRuleButton*.test.jsx`, `reachable.test.js` and `tapFloor.test.js`.** Mutation-prove case 2: drop the lift check and see case 2 fail. Then restore.
- [ ] **Step 5: Commit and push.** Message: `feat(journal): checklist from my winners - suggested before-entry items with evidence (P2 T3)`.

---

### Task 7: Wrapped data

**Files:** Create `S/wrapped.py` and `tests/test_wrapped.py`. Modify `api/routers/journal_two.py`.

**Interfaces (produces):**
```python
def year_wrapped(conn, user_id: str, year: int, account_id: str | None) -> dict:
    """{"year": int, "tradeCount": int,
        "bestSetups": [{"setup": str, "tradeCount": int, "expectancyR": float|None, "sample": "too_few"|"thin"|"ok"}],
        "tickers": [{"symbol": str, "noteCount": int}],
        "discipline": [{"month": "YYYY-MM", "adherence": float|None, "tradeCount": int}],
        "lessons": [{"ruleId": str, "label": str, "version": int, "changeNote": str|None, "changedAt": str}],
        "available": bool}"""
```
- Route: `GET /api/j2/wrapped/{year}?account_id=`, behind `require_paid`, 404 with the switch off.
- `year` must be between 2000 and the current ET year, else 400 `That year isn't available.`
- `available`:
  - is false for the current year before December 1 ET;
  - is false for any year with no closed trade;
  - when false, the arrays are empty, so the page shows the "not ready" sentence.
- Sections follow R-T3-9, with these names.
  - `sample` comes from `sample_size.py`'s own labels. Map them exactly. Never restate the thresholds.
  - `discipline` always has 12 entries, Jan-Dec.

- [ ] **Step 1: Write the failing tests.** Seed one member's year:
  1. The top 3 setups by expectancy, with counts. A 4-trade setup reads `too_few`.
  2. Tickers count a note once, even if it mentions `$NVDA` twice and has `ticker='NVDA'`. Trashed and archived notes are excluded.
  3. **Months without adherence read None.** A month with trades and no adherence rows gives `adherence: None` and its `tradeCount`.
  4. Lessons: three rule versions in the year and one the year before → three, newest first.
  5. The current year before December → `available: false`, and in December → `true` (pin the clock the way the analytics tests do).
  6. The `account_id` scope is honoured.
  7. Another member's rows are never read.
  8. 404 with the switch off; 400 for year 1999.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Use V10's existing functions for expectancy and adherence. Do not recompute expectancy.
- [ ] **Step 4: Run them, plus the existing `playbook_stats` and sample-size tests.**
- [ ] **Step 5: Commit and push.** Message: `feat(journal): your trading year - wrapped data endpoint (P2 T3)`.

---

### Task 8: The Wrapped page

**Files:**
- Create: `J/pages/WrappedPage.jsx`, `WrappedPage.module.css`, `WrappedPage.test.jsx`
- Modify: `app/src/App.jsx` (one lazy route, in V11's idiom), the Report page (one door)

**Behaviour:**
- **Route.** `/journal-2-0/wrapped/:year` renders `WrappedPage` lazily. The account picker is the Journal's own.
- **Layout.** A one-column page titled `Your <year> in trading`, with four `TileCard` sections, each with a UIcon:
  - **Best setups.** Rows show the setup, trades and expectancy R, with the sample label.
  - **Most-written tickers.** Symbol chips, each with a count, each linking to the Notebook filtered by that ticker (the existing ticker filter URL; V11).
  - **Discipline trend.** A 12-month bar list showing the adherence %, or `—`, and the trade count.
  - **Lessons you wrote into your rules.** The lesson rows.
- **Empty and not-ready sentences:**
  - Not available yet: `Your <year> trading year opens on December 1.`
  - No trades: `No closed trades in <year>.`
  - A section with nothing: `Nothing here yet.`
- **Report page door.** The Report page shows `Your <year> in trading` only when `tier3Enabled()`:
  - for the current year from December 1 ET;
  - plus a year picker listing earlier years that have closed trades. Years come from the trade list the Report page already holds; never a new fetch.

- [ ] **Step 1: Write the failing tests:**
  1. With the switch off, there is no door and the route renders the Journal's not-found.
  2. A payload fixture renders all four sections with their text.
  3. The not-ready sentence renders.
  4. `—` renders for a None month.
  5. The door shows in December and not in October (pin the clock).
  6. Every heading and link has an accessible name.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests plus `reachable.test.js` and `tapFloor.test.js`.**
- [ ] **Step 5: Commit and push.** Message: `feat(journal): your trading year page and the Report page door (P2 T3)`.

---

### Task 9: Contract fixtures

- [ ] **Step 1:** Add fixtures for:
  - `GET /api/j2/insights/checklist-suggestions`
  - `GET /api/j2/wrapped/{year}`
  - the `psychology.checkIns` slice of `GET /api/j2/analytics`

  Generate them through `tools/notebook_contract_fixtures.py`, the way P3a Task 8 does, and add the client-side readers' fixture tests.
- [ ] **Step 2:** Run the contract tests. Commit and push. Message: `test(journal): contract fixtures for Tier 3 endpoints (P2 T3)`.

---

### Task 10: Accessibility, the walk, typing and bytes

- [ ] **Step 1: Accessibility.** Add axe recipes for `CheckInOutcomes`, `ChecklistFromWinners` and `WrappedPage`, and run them with the coverage rail.
- [ ] **Step 2: The walk.** Write `tools/journal_tier3_walk.py`, copying P3a's walk shape. Its header names `JOURNAL_TIER3_ENABLED=1` and `JOURNAL_STYLES_ENABLED=1` in the sandbox. Seed the sandbox with ≥ 25 closed trades carrying emotion tags. Steps:
  1. Insert the check-in from the slash menu, pick Good and Focused, navigate away within 1.5 s, reopen, and assert both are kept and no conflicted copy appeared (the spec's P0.0 repro shape).
  2. Insights → psychology → By check-in shows the day.
  3. Insights → Checklist from my winners shows at least one suggestion. Accept it. The pre-entry checklist block in a new trade plan now lists it.
  4. Report → Your <year> in trading shows four sections.

  Run it at 1280 / 820 / 390. The raw output goes under `docs/notebook/evidence/t3-walk-<run-id>/` and is committed first.
- [ ] **Step 3: Typing.** Re-measure with the instrument of record (`docs/notebook/perf-budgets.md`, "Quiet re-read 2026-10-09"), on a note holding one of every block including the check-in. Report p95 against the baseline. A regression is a stop.
- [ ] **Step 4: Bytes.** Build, measure and commit the raw output. The closure must be ≤ V12 + 700 B.
- [ ] **Step 5: Commit and push.** Message: `test(journal): Tier 3 a11y, walk, typing and bytes evidence (P2 T3)`.

---

### Task 11: Gate, review, PR, arming

Same steps as P3a Task 12:
- the gate in its own worktree on a `notebook-*` branch, run only when no other gate is on the box;
- the final review;
- the arming packet `docs/notebook/t3-arming.md`. Its checks after arming:
  - the payload key is true;
  - the smoke account inserts a check-in and then deletes the note through the product;
  - the suggestions route answers;
  - `/api/j2/wrapped/<last year>` answers;
- merge master, then run carry-over, the C4 rails and bytes on the landing tree;
- the PR, which the owner merges;
- after the merge: promote, wait for web SUCCESS, then smoke.

---

## Self-review (done at write time)

1. **Spec coverage:**
   - Item 13, Year Wrapped with best setups, lessons, most-written tickers and discipline trend: Tasks 7-8, rulings R-T3-7 to R-T3-9.
   - Item 14, a mood/focus check-in block feeding the psychology views: Tasks 3-5.
   - Item 15, checklist from winners as a suggestion only, with trades as evidence and each item accepted by the member: Task 6, rulings R-T3-4 to R-T3-6.
   - §6, the cross-cutting requirements:
     - schema: no new node;
     - performance: Task 10;
     - a11y: Tasks 3, 8 and 10;
     - privacy: R-T3-1, and the vendor row in Task 3;
     - rollback: the switch;
     - the ONE-FACT pairs: Task 3's BLOCK_KINDS and Task 5's words.
2. **Placeholders.** None. Where a name must be read from code, the step names the V-item that answers it.
3. **Names used identically across tasks:** `moodCheckIn`, `nextCheckinParams`, `MOOD_WORDS`, `FOCUS_WORDS`, `j2_note_checkins`, `_checkin_section`, `checkIns`, `suggest`, `year_wrapped`, `tier3Enabled`, `isTier3Block`.
4. **Review Focus.** Each line has its named test.
