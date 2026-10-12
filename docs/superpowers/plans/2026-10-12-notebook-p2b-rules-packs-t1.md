# Notebook P2 Tier 1 (part b): Rules, Versions, Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members keep versioned trading rules ("v3 · changed Oct 2"), mark rules "before entry" so they join the pre-entry checklist, see what each rule version changed in Insights ("Before / after this rule", sample sizes printed), and get the daily prep pack and the post-trade review pack as blocks in the Daily prep and Post-trade review styles. A version restore no longer leaves a note stamped with a style version its body does not match (P1 parked M-7). Then the release is armed: NVDA pass, flag, ledger.

**Architecture:**
- **Part a's platform, unchanged.** Every new block is a trader block exactly as part a defined it (`docs/superpowers/plans/2026-10-12-notebook-p2-trader-blocks-t1.md`): a registry manifest via `blockManifest`, a row in both catalogs, a server builder in `trader_blocks.BUILDERS`, a lazy body in `BLOCK_COMPONENTS`, state only through `setParams`.
- **One new table, one new write door that is not a note door.** `j2_journal_rule_versions` records every change to a rule's words. Rules gain `before_entry` and `version`. The edit door (`PUT /api/j2/trader-blocks/rules/{id}`) writes rules, never a note; part a's door rail names it as an exception with that reason.
- **Packs read; they never write the note on their own.** The four prep blocks and the review block read through one new read route each. A prep block freezes its reading into its own params on an explicit "Capture" (and the composer captures it at creation), like part a's market context.
- **M-7 is fixed where the stamp lives.** A note version records the style stamp it was taken at; a restore writes that stamp back in the same compare-and-set.

**Tech Stack:** FastAPI + SQLite (`auth.db`, `j2_` tables), React + Vite, TipTap 2, vitest + Testing Library, acorn, pytest, Python Playwright, NVDA (the owner's box only, muted).

**Spec:** `docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md`, §P2 preamble and Tier 1 items 1 (the "before entry" half), 2, 6 and 7 (lines 219-262); §6; §7 decision 5; §8 ("P1 + P2 T1 (one release)"). Part a: `docs/superpowers/plans/2026-10-12-notebook-p2-trader-blocks-t1.md`. P1 ledger: `.superpowers/sdd/2026-10-11-notebook-p1-journal-styles-core/progress.md` (R25: "M-7 (restore keeps newer style_version) -> P2 notes").

**Base:** `origin/master` after part a's PR is merged (or part a's branch tip `notebook-p2-blocks`, if part b starts before that merge; Task 0 records which). Worktree `C:\Users\Patrick\uct-worktrees\notebook-p2`, branch `notebook-p2b-rules`.

## Rulings this plan makes (each also in the PR body)

- **R-P2b-1, what a rule version is.** A new version is recorded when a rule's WORDS change (label or evidence). Marking a rule "before entry" moves where the rule shows, not what it says, and records no version. Creating a rule records v1. Cost if wrong: a member who expects "now checked before entry" to split before/after does not get that boundary.
- **R-P2b-2, existing rules get v1 lazily.** A rule made before this release has no version row. The service writes its v1 (dated the rule's `created_at`) the first time it is edited or its versions are read, inside the same transaction. No boot-time migration over every member's rules. Cost if wrong: a read of an old rule's versions is a write; it is idempotent (`INSERT OR IGNORE` on `(rule_id, version)`).
- **R-P2b-3, the before/after windows.** For version k, BEFORE is the window of version k-1 (for v1, every earlier trade) and AFTER is version k's own window (to the next version, or now). A trade belongs to a window by its entry day (ET date), the change day counting as AFTER. Trades come from the rule's account (all accounts when the rule has none), excluding `analytics_excluded` trades. Win rate, average R and adherence are printed with their sample sizes; under 10 trades the card says "too few trades to read as a rate" and shows counts, never a bare percentage (spec: "never a percentage on fewer than 10 trades without saying so").
- **R-P2b-4, "the review drafts".** The spec says unticked pre-entry items carry "into the trade's adherence card and the review drafts". Part a carries them into the adherence card (R-P2-7). Here they carry into the post-trade review pack, the draft a member writes from the Post-trade review style. The wave-13 review drafts (`NOTEBOOK_REVIEW_DRAFTS_ENABLED`, daily/weekly/monthly) are not changed. Cost if wrong: a follow-up row adds the unticked count to the daily review draft.
- **R-P2b-5, one review block.** The review pack is ONE block, `tradeReview`, with three parts (the trade card, the plan-vs-execution grade, the mistake and emotion tags) reading one linked trade, because all three answer for the same trade and one trade picker is the honest control. "What I'd do differently" stays the outline heading the built-in Post-trade review style already carries (`journal_styles.py`, `_h("What I'd do differently")`).
- **R-P2b-6, the prep pack freezes.** A daily prep note is about that morning. Each prep block freezes what it read (with its as-of) at creation, or on the member's "Capture now", and shows "Capture again"; it never re-reads on open, so a note opened in a month still shows that morning.
- **R-P2b-7, arming is one flip after both parts.** `NOTEBOOK_JOURNAL_STYLES_ENABLED` is armed once, after part b lands and the pre-arming checks pass (Task 15). NVDA runs against the sandbox before arming when the tool can sign in there (V9); otherwise it runs against production immediately after the flip, and any FAIL turns the flag back off first.

## Global Constraints

Part a's Global Constraints apply unchanged (names, paid, dark switch, creating-not-rendering, the INTEGRITY RULE, zero schema bumps, ONE-FACT rails, preference keys, gate read paths, key listeners, settle rule, tests, commits, hygiene, `C:\data`, at most 3 agents, mutation restores). In addition:

- **New table** `j2_journal_rule_versions`: classified in `api/services/address_space.py` (`EXEMPT`, "not-a-saved-object"), purged by `api/services/journal_two/account_purge.py`, and listed in `docs/account-deletion-manifest.md` regenerated with `python tools/account_deletion_manifest.py --write`, all in the task that adds it (Task 3).
- **New columns** are additive with defaults (`j2_journal_rules.before_entry`, `.version`; `j2_note_versions.style_id`, `.style_version`, `.style_captured`), appended to `db.py`'s `_PHASE_2_ALTERS`. Nothing reads them as required.
- Bytes: part b's first-open allowance is **+1,536 B** (six registry rows ≤ 1,024 B, six slash items ≤ 512 B). Everything else is lazy.
- Every new route lives in `api/routers/notebook_journal_styles.py` behind its gate and `require_paid`, with a contract fixture.
- NVDA (Task 15): started with a config whose synth is `silence` (`tools/notebook_nvda_pass.py` header: "Prefer starting it with `--config-path` at a config whose synth is `silence`"), and QUIT in teardown from PowerShell (`& 'C:/Program Files/NVDA/nvda.exe' -q`), then proved gone (`Get-Process nvda -ErrorAction SilentlyContinue` empty). Never `Stop-Process` from Bash, never left running.

## Review Focus

1. **A member edits a rule while the Insights card is open on that rule.** The card must show the new version on its next read and never an "after" window for a version that does not exist. Pinned in Task 4, `test_versions_and_windows_follow_an_edit`.
2. **A rule with zero trades in a window, or trades without an R multiple, or without an adherence record.** Each count is printed beside its value; a missing value is "no trades" / "no R recorded" / "no checklist record", never 0% or NaN. Pinned in Task 4, `test_empty_and_partial_windows_say_so`, and Task 9, `RuleBeforeAfterCard.test.jsx` "under 10 trades".
3. **A version restore of a note made before this release** (its version rows carry no stamp). The restore must not write a wrong stamp: it keeps the style and clears the version, so "Update layout" is offered again. Pinned in Task 5, `test_a_restore_from_a_legacy_version_reoffers_the_update`.
4. **The review block's trade is deleted, or belongs to a broker resync that re-keyed it.** The block says "This trade is no longer in your journal" and keeps the note, never an empty card or an error. Pinned in Task 7, `test_review_of_a_missing_trade_is_404`, and Task 11, `TradeReviewBlock.test.jsx` "trade gone".
5. **A prep block captured on a morning with no wire, no earnings cache and the setups board off.** Each part says why it is empty (labelled missing / "needs the active setups board"), and Capture again works later. Pinned in Task 6, `test_each_part_labels_its_gap`, and Task 10, `PrepBlocks.test.jsx` "each gap is named".

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `docs/notebook/p2b-verify-before-building.md` (new) | citations re-read; open items V1-V10 answered | 1 |
| `api/services/journal_two/journal_styles.py` | six catalog rows; Daily prep v2, Post-trade review v2 | 2, 12 |
| `J/lib/journalBlocks.js`, `src/widgets/registry.js` (+ test) | six client catalog rows, six manifests | 2 |
| `B/blocks/BlockNodeView.jsx` + six stub bodies | six `BLOCK_COMPONENTS` entries | 2 |
| `api/services/journal_two/db.py` | the versions table, the rule columns, the note-version columns | 3, 5 |
| `api/services/journal_two/rule_versions.py` (new) | versions, edits, before/after | 3, 4 |
| `api/services/journal_two/journal_rules.py` | `beforeEntry`/`version` on the rule record; v1 on create | 3 |
| `api/services/journal_two/account_purge.py`, `docs/account-deletion-manifest.md`, `api/services/address_space.py` | the new table | 3 |
| `api/services/journal_two/notes.py` | M-7: capture and restore the stamp | 5 |
| `api/services/journal_two/trader_blocks.py` | prep reads, review read, their builders | 6, 7 |
| `api/routers/notebook_journal_styles.py`, `tools/notebook_contract_fixtures.py`, fixtures | rule, prep and review routes | 3, 4, 6, 7 |
| `B/blocks/MyRulesBlock.jsx`, `J/lib/blocks/rulesApi.js` | the My rules block, rule edit, before entry | 8 |
| `J/lib/blocks/blockDoors.test.js` | `rulesApi.js` named as a non-note write | 8 |
| `J/components/insights/RuleBeforeAfterCard.jsx`, `PsychologySection.jsx` | the Insights card | 9 |
| `B/blocks/Prep*Block.jsx`, `B/blocks/prepCapture.jsx` | the four prep blocks | 10 |
| `B/blocks/TradeReviewBlock.jsx` | the review block | 11 |
| `B/SlashMenu.jsx` | six slash items | 12 |
| walk, door rows, perf harness, evidence | as part a's Task 13 | 13 |
| `docs/notebook/screen-reader-pass.md`, `docs/feature_flags.json` | NVDA rows; the arming record | 15 |

`J` = `app/src/pages/journal-2-0`, `B` = `J/components/notebook`.

## Lanes and waves

| Wave | Lane | Tasks | Agent |
|---|---|---|---|
| W0 | F | 0, 1, 2 | one |
| W1 | S (rules) | 3 → 4 | opus |
| W1 | M (M-7) | 5 | opus |
| W1 | P (packs, server) | 6 → 7 | opus |
| W2 | A (rules, client) | 8 → 9 | opus |
| W2 | B (packs, client) | 10 → 11 | sonnet |
| W3 | integrator | 12 → 13 → 14 | controller + one agent |
| W4 | integrator, at arming | 15 | controller (owner's box) |

Files shared by more than one task:

| File | Tasks | Resolution |
|---|---|---|
| `db.py` (`_PHASE_2_ALTERS`) | 3, 5 | lanes S and M both APPEND; integrator merges (append-only) |
| `notebook_journal_styles.py` | 3, 4, 6, 7 | S (3→4) and P (6→7) both append routes; integrator merges |
| contract fixtures builder + dir | 3, 4, 6, 7 | same as above; regenerate once after the merge |
| `trader_blocks.py` | 6, 7 | lane P, in order |
| `journal_styles.py` | 2, 12 | W0 then W3 |
| `registry.js`, `journalBlocks.js`, `BlockNodeView.jsx` | 2 only | rows and stubs in W0; 8, 10, 11 replace their own stub files |
| `blockDoors.test.js` | 8 only | |

---

### Task 0: Worktree

- [ ] **Step 1: Branch from the right base**

If part a is merged: `git -C /c/Users/Patrick/uct-worktrees/notebook-p2 fetch origin && git -C /c/Users/Patrick/uct-worktrees/notebook-p2 switch -c notebook-p2b-rules origin/master`. If not: `git -C /c/Users/Patrick/uct-worktrees/notebook-p2 switch -c notebook-p2b-rules notebook-p2-blocks`, and the PR's base is then part a's branch. Record which in the PR body. The worktree, its owner file and its `node_modules` junction are part a's.

- [ ] **Step 2: Baseline**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_trader_blocks.py tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_update.py tests/test_notebook_journal_styles_router.py tests/test_notebook_contract_fixtures.py tests/test_address_space.py tests/test_account_deletion_manifest.py tests/test_journal_two_notes_versions_router.py -q > "$TEMP/p2b-baseline-py.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/components/notebook/blocks src/pages/journal-2-0/lib/blocks src/widgets/registry.test.js src/pages/journal-2-0/components/insights/MyRulesList.test.jsx src/pages/journal-2-0/components/insights/PsychologySection.test.jsx > "$TEMP/p2b-baseline.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Read both totals. Record pre-existing reds by name.

---

### Task 1: Verify before building, written down

**Files:**
- Create: `docs/notebook/p2b-verify-before-building.md`

- [ ] **Step 1: Re-verify every citation**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
grep -n "CREATE TABLE IF NOT EXISTS j2_journal_rules (" api/services/journal_two/db.py
grep -n "def create_rule(" api/services/journal_two/journal_rules.py
grep -n "def _row_to_dict(row: sqlite3.Row) -> dict\[str, Any\]:" api/services/journal_two/journal_rules.py
grep -n '@router.post("/accounts/{account_id}/rules")' api/routers/journal_two.py
grep -n '    "j2_journal_rules",' api/services/journal_two/account_purge.py
grep -n '"j2_journal_styles": "no-door: a journal style is opened from the Styles manager' api/services/address_space.py
grep -n "CREATE TABLE IF NOT EXISTS j2_note_versions (" api/services/journal_two/db.py
grep -n '"ALTER TABLE j2_note_versions ADD COLUMN restored_from_version_id TEXT",' api/services/journal_two/db.py
grep -n "def _maybe_capture_version(" api/services/journal_two/notes.py
grep -n "INSERT INTO j2_note_versions (id, user_id, note_id, title, subtitle," api/services/journal_two/notes.py
grep -n "^def get_note_version(" api/services/journal_two/notes.py
grep -n "^def restore_note_version(" api/services/journal_two/notes.py
grep -n "style_stamp: tuple\[str, int\] | None = None," api/services/journal_two/notes.py
grep -n '"ALTER TABLE j2_trades ADD COLUMN analytics_excluded INTEGER DEFAULT 0",' api/services/journal_two/db.py
grep -n '"ALTER TABLE j2_trades ADD COLUMN mistake_tags TEXT",' api/services/journal_two/db.py
grep -n '"mistakeTags": json.loads' api/services/journal_two/trades.py
grep -n "^def list_adherence_for_user(" api/services/journal_two/adherence_store.py
grep -n "^def trade_ref_for_row(row) -> str:" api/services/journal_two/trade_refs.py
grep -n '^EARNINGS_CACHE_KEY = "earnings"' api/services/engine.py
grep -n "^def get_rundown() -> dict:" api/services/engine.py
grep -n "^def extract_rundown_speech_text(html: str) -> str:" api/services/rundown_speech.py
grep -n "^def get_user_ticker_sets(user_id: str) -> dict:" api/services/calendar_personalization.py
grep -n "^def build_cards(conn: sqlite3.Connection, user_id: str" api/services/journal_two/setups_board.py
grep -n "return plan_grading.grade_payload(conn, user\[\"id\"\], t)" api/routers/notebook_plan_grades.py
grep -n '_h("What I.d do differently"), _p())},' api/services/journal_two/journal_styles.py
grep -n "<MyRulesList" app/src/pages/journal-2-0/components/insights/PsychologySection.jsx
grep -n "Prefer starting it with \`--config-path\` at a config whose synth is \`silence\`" tools/notebook_nvda_pass.py
```

Each grep prints exactly one line; record each `file:line`.

- [ ] **Step 2: Answer the open items**

- **V1 — Part a on the base.** `git merge-base --is-ancestor <part a merge sha> HEAD`; the registry rows `preEntryChecklist`…`positionSizing` and `trader_blocks.BUILDERS` exist.
- **V2 — The version row's dict.** Read `get_note_version`'s return (`notes.py`, the dict carrying `"restoredFromVersionId"`): the keys Task 5 adds beside it.
- **V3 — `_maybe_capture_version`'s `existing` row.** Confirm it is the full `j2_notes` row (it reads `existing["body_json"]`), so `existing["style_id"]` and `existing["style_version"]` are readable.
- **V4 — `build_cards`' `prices` seam.** Read what `prices(symbols)` must answer (a `{symbol: {...}}` map with which keys) and what the cards carry (symbol, levels, distance). Task 6 passes a cache-only `prices`.
- **V5 — `member_interest.SOURCES` and `all_mine`.** `grep -n "^SOURCES" api/services/member_interest.py`; Task 6 uses `all_mine`.
- **V6 — The earnings payload.** `cache.get("earnings")` answers `{bmo: [{sym, ...}], amc: [...]}` (the CatalystFlow shape); confirm the key names.
- **V7 — `plan_grading.grade_payload`'s answer.** The fields the review block shows (grade, the planned vs actual entry/stop/exit), and `plan_grading.enabled()` (`NOTEBOOK_PLAN_GRADING_ENABLED`).
- **V8 — `usePlanGrade.js`.** Whether the client hook can be reused by the review block (it reads `/api/j2/plan-grades/trades/{id}`) or the block uses Task 7's combined read only.
- **V9 — Can the NVDA tool run against a sandbox?** Read `tools/notebook_nvda_pass.py`'s sign-in (`SMOKE_EMAIL`/`SMOKE_PASSWORD` against `--base`) and `scripts/hub_sandbox_boot.py`'s account minting (`ADMIN_EMAILS`). If a sandbox account can be made with the smoke address and a known password, Task 15 runs NVDA pre-arming against the sandbox; otherwise post-flip against production (R-P2b-7).
- **V10 — `docs/notebook/screen-reader-pass.md`'s row format.** The table columns and how the tool parses a row (`ROWS`), so Task 15's new rows are read by the tool.

- [ ] **Step 3: Write and commit**

Create `docs/notebook/p2b-verify-before-building.md` (the measured `HEAD`, `§cite`, `§V1`-`§V10`), then:

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add docs/notebook/p2b-verify-before-building.md
git commit -F - -- docs/notebook/p2b-verify-before-building.md <<'MSG'
docs(notebook): P2b verify-before-building (citations re-read, ten open items answered)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 2: Catalog rows, registry manifests and stubs for the six part-b blocks

**Files:**
- Modify: `api/services/journal_two/journal_styles.py` (`BLOCK_KINDS`)
- Modify: `app/src/pages/journal-2-0/lib/journalBlocks.js`
- Modify: `app/src/widgets/registry.js`, `registry.test.js`
- Modify: `app/src/pages/journal-2-0/components/notebook/blocks/BlockNodeView.jsx` (`BLOCK_COMPONENTS`)
- Create: stub bodies `MyRulesBlock.jsx`, `PrepWireBlock.jsx`, `PrepEarningsBlock.jsx`, `PrepMoversBlock.jsx`, `PrepLevelsBlock.jsx`, `TradeReviewBlock.jsx`
- Modify: `api/services/journal_two/trader_blocks.py` (`BLOCK_IDS`, builders for `myRules` only; the prep and review builders are Tasks 6 and 7)

**Interfaces:**
- Block ids: `myRules`, `prepWire`, `prepEarnings`, `prepMovers`, `prepLevels`, `tradeReview`.
- Catalog settings: `myRules` → none; `prepWire`/`prepEarnings`/`prepMovers`/`prepLevels` → none; `tradeReview` → none. `search`: `[my rules]`, `[morning wire and exposure]`, `[earnings for my names]`, `[my movers]`, `[key levels from my plans]`, `[post-trade review]`. Labels: "My rules", "Morning wire and exposure", "Earnings for my names", "My movers", "Key levels from my plans", "Post-trade review".
- Registry params: `myRules` → `[]`; each prep block → `[{key: 'snapshot', type: 'json'}]`; `tradeReview` → `[{key: 'tradeId', type: 'string'}]`.
- Until Tasks 6/7 land, `trader_blocks.BUILDERS` must still cover every catalog id (the builder rail): Task 2 adds `myRules` (params `{}`) and, for the five others, a builder that makes the node with empty params (`snapshot` absent, `tradeId` ""), which Tasks 6 and 7 replace with capturing builders.

- [ ] **Step 1: Failing tests**

In `tests/test_trader_blocks.py`, change the parametrized id list in `test_each_builder_makes_a_body_the_editor_can_build` to all ten trader block ids, and in `test_every_trader_block_has_a_catalog_row_and_a_builder` nothing changes (it reads `tb.BLOCK_IDS`). In `registry.test.js`, extend `CAPTURE_ONLY` and the part-a `block` case's expected list to the ten ids in declaration order. Run both; expect FAIL.

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_trader_blocks.py tests/test_journal_styles_store.py -q > "$TEMP/p2b-t2.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

- [ ] **Step 2: Server rows and placeholder builders**

Append to `journal_styles.BLOCK_KINDS`:

```python
    # P2 Tier 1 (part b).
    {"id": "myRules", "search": "[my rules]", "settings": ()},
    {"id": "prepWire", "search": "[morning wire and exposure]", "settings": ()},
    {"id": "prepEarnings", "search": "[earnings for my names]", "settings": ()},
    {"id": "prepMovers", "search": "[my movers]", "settings": ()},
    {"id": "prepLevels", "search": "[key levels from my plans]", "settings": ()},
    {"id": "tradeReview", "search": "[post-trade review]", "settings": ()},
```

In `trader_blocks.py`, extend `BLOCK_IDS` with the six ids and add to `BUILDERS`:

```python
def _empty(block_id: str, params: dict | None = None):
    def build(block: dict, ctx: dict):
        return _node(block_id, dict(params or {}), ctx), None
    return build


BUILDERS.update({
    "myRules": _empty("myRules"),
    "prepWire": _empty("prepWire"), "prepEarnings": _empty("prepEarnings"),
    "prepMovers": _empty("prepMovers"), "prepLevels": _empty("prepLevels"),
    "tradeReview": _empty("tradeReview", {"tradeId": ""}),
})
```

- [ ] **Step 3: Client rows, manifests, stubs**

Append the six rows to `journalBlocks.js` `BLOCK_KINDS` (`settings: Object.freeze([])`, the labels and `search` above). Add six `blockManifest(...)` entries to `registry.js` after `positionSizing` with the params above and the `search` lines. Add six `lazyLeaf` entries to `BLOCK_COMPONENTS` and create each stub body exactly as part a's Task 6 stubs (`BlockEmpty title="This block is being built."`).

- [ ] **Step 4: Run, then commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_trader_blocks.py tests/test_journal_styles_store.py tests/test_trader_blocks_no_note_door.py -q > "$TEMP/p2b-t2.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/widgets/registry.test.js src/pages/journal-2-0/components/notebook/blocks src/pages/journal-2-0/lib/blocks src/components/screener/reachable.test.js > "$TEMP/p2b-t2-js.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add api/services/journal_two/journal_styles.py api/services/journal_two/trader_blocks.py app/src/pages/journal-2-0/lib/journalBlocks.js app/src/widgets/registry.js app/src/widgets/registry.test.js app/src/pages/journal-2-0/components/notebook/blocks tests/test_trader_blocks.py
git commit -F - -- api/services/journal_two/journal_styles.py api/services/journal_two/trader_blocks.py app/src/pages/journal-2-0/lib/journalBlocks.js app/src/widgets/registry.js app/src/widgets/registry.test.js app/src/pages/journal-2-0/components/notebook/blocks tests/test_trader_blocks.py <<'MSG'
feat(notebook): P2b block kinds -- six catalog rows, manifests and stub bodies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 3: Rule versions, "before entry", and the rule edit door

Spec §P2 item 2; R-P2b-1, R-P2b-2.

**Files:**
- Modify: `api/services/journal_two/db.py` (schema + `_PHASE_2_ALTERS`)
- Create: `api/services/journal_two/rule_versions.py`
- Modify: `api/services/journal_two/journal_rules.py` (`create_rule` writes v1; `_row_to_dict` adds `beforeEntry`, `version`, `changedAt`)
- Modify: `api/routers/notebook_journal_styles.py` (two routes), `tools/notebook_contract_fixtures.py`
- Modify: `api/services/journal_two/account_purge.py`, `docs/account-deletion-manifest.md`, `api/services/address_space.py`
- Test: `tests/test_rule_versions.py` (new)

**Interfaces:**
- Table:

```sql
CREATE TABLE IF NOT EXISTS j2_journal_rule_versions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    rule_id     TEXT NOT NULL,
    version     INTEGER NOT NULL,
    label       TEXT NOT NULL,
    evidence    TEXT,
    changed_at  TEXT NOT NULL,
    change_note TEXT,
    UNIQUE (rule_id, version)
);
CREATE INDEX IF NOT EXISTS idx_j2_rule_versions_user_rule ON j2_journal_rule_versions(user_id, rule_id);
```

- Alters: `ALTER TABLE j2_journal_rules ADD COLUMN before_entry INTEGER NOT NULL DEFAULT 0`, `ALTER TABLE j2_journal_rules ADD COLUMN version INTEGER NOT NULL DEFAULT 1`.
- `rule_versions.edit_rule(user_id, rule_id, patch) -> dict | None` with `patch` keys `label`, `evidence`, `beforeEntry` (bool), `changeNote`; returns the rule record; None when not the member's rule. Raises `rule_versions.RuleEditError` (400) on a blank label.
- `rule_versions.list_versions(user_id, rule_id) -> list[dict] | None`, newest first: `{version, label, evidence, changedAt, changeNote}`.
- Rule record gains `"beforeEntry": bool`, `"version": int`, `"changedAt": str` (the current version's `changed_at`, else `created_at`).
- Routes: `PUT /api/j2/trader-blocks/rules/{rule_id}`, `GET /api/j2/trader-blocks/rules/{rule_id}/versions` (404 for another member's rule).

- [ ] **Step 1: Failing tests**

`tests/test_rule_versions.py`:

```python
"""Spec §P2 item 2 (R-P2b-1, R-P2b-2): every change to a rule's words is a version; before entry is not."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _rule(user="u1", label="No trades in the first 5 minutes"):
    from api.services.journal_two import journal_rules
    return journal_rules.create_rule(user, "a1", label)


def test_create_records_v1(db_path):
    from api.services.journal_two import rule_versions as rv
    r = _rule()
    assert (r["version"], r["beforeEntry"]) == (1, False)
    assert [v["version"] for v in rv.list_versions("u1", r["id"])] == [1]


def test_a_word_change_is_a_version_before_entry_is_not(db_path):
    from api.services.journal_two import rule_versions as rv
    r = _rule()
    r2 = rv.edit_rule("u1", r["id"], {"label": "No trades in the first 15 minutes", "changeNote": "too early"})
    assert r2["version"] == 2
    r3 = rv.edit_rule("u1", r["id"], {"beforeEntry": True})
    assert (r3["version"], r3["beforeEntry"]) == (2, True)
    vs = rv.list_versions("u1", r["id"])
    assert [(v["version"], v["label"], v["changeNote"]) for v in vs] == [
        (2, "No trades in the first 15 minutes", "too early"), (1, "No trades in the first 5 minutes", None)]


def test_an_unchanged_label_is_no_version(db_path):
    from api.services.journal_two import rule_versions as rv
    r = _rule()
    assert rv.edit_rule("u1", r["id"], {"label": "No trades in the first 5 minutes"})["version"] == 1


def test_a_rule_from_before_this_release_gets_v1_lazily(db_path):
    from api.services.auth_db import get_connection
    from api.services.journal_two import rule_versions as rv
    c = get_connection()
    c.execute("INSERT INTO j2_journal_rules (id, user_id, account_id, label, status, created_at, updated_at)"
              " VALUES ('old', 'u1', 'a1', 'Old rule', 'active', '2026-01-02T00:00:00+00:00', '2026-01-02T00:00:00+00:00')")
    c.commit(); c.close()
    vs = rv.list_versions("u1", "old")
    assert [(v["version"], v["changedAt"]) for v in vs] == [(1, "2026-01-02T00:00:00+00:00")]
    assert rv.list_versions("u1", "old") == vs                         # idempotent


def test_another_members_rule_is_none(db_path):
    from api.services.journal_two import rule_versions as rv
    r = _rule(user="u2")
    assert rv.edit_rule("u1", r["id"], {"label": "x"}) is None
    assert rv.list_versions("u1", r["id"]) is None


def test_a_blank_label_is_refused(db_path):
    from api.services.journal_two import rule_versions as rv
    with pytest.raises(rv.RuleEditError):
        rv.edit_rule("u1", _rule()["id"], {"label": "   "})


def test_the_rules_list_carries_before_entry(db_path):
    from api.services.journal_two import journal_rules, rule_versions as rv
    r = _rule()
    rv.edit_rule("u1", r["id"], {"beforeEntry": True})
    assert journal_rules.list_rules("u1", "a1")[0]["beforeEntry"] is True


def test_routes(db_path):
    from api.routers import notebook_journal_styles as rt
    app = FastAPI()
    app.include_router(rt.router)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "pro"}
    c = TestClient(app)
    r = _rule()
    got = c.put(f"/api/j2/trader-blocks/rules/{r['id']}", json={"label": "Wait 15 minutes", "changeNote": "n"})
    assert got.status_code == 200 and got.json()["version"] == 2
    assert c.get(f"/api/j2/trader-blocks/rules/{r['id']}/versions").json()["versions"][0]["version"] == 2
    assert c.put("/api/j2/trader-blocks/rules/nope", json={"label": "x"}).status_code == 404
    assert c.put(f"/api/j2/trader-blocks/rules/{r['id']}", json={"label": ""}).status_code == 400
```

Add to `tests/test_address_space.py`'s expectations nothing: its rail fails while the table is unclassified, which is Step 4's job.

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_rule_versions.py tests/test_address_space.py tests/test_account_deletion_manifest.py -q > "$TEMP/p2b-t3.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL.

- [ ] **Step 3: Schema and service**

In `db.py`, add the table and index to the `j2_` schema block beside `j2_journal_rules`, and append the two `ALTER TABLE j2_journal_rules` rows to `_PHASE_2_ALTERS`.

`rule_versions.py`:

```python
"""Rule versions (Notebook P2 Tier 1, spec §P2 item 2; R-P2b-1, R-P2b-2).

A version is recorded when a rule's WORDS change (label or evidence); v1 when it is made. Marking a rule
"before entry" changes where it shows, not what it says, and records no version. ⛔ Rules are not notes:
nothing here touches j2_notes. Every query is scoped by user_id.
"""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection

_LABEL_MAX = 200
_NOTE_MAX = 500


class RuleEditError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rule_row(conn: sqlite3.Connection, user_id: str, rule_id: str):
    return conn.execute("SELECT * FROM j2_journal_rules WHERE id = ? AND user_id = ?", (rule_id, user_id)).fetchone()


def _ensure_v1(conn: sqlite3.Connection, row: sqlite3.Row) -> None:
    """R-P2b-2: a rule made before this release gets its v1, dated its creation."""
    conn.execute("INSERT OR IGNORE INTO j2_journal_rule_versions (id, user_id, rule_id, version, label, evidence,"
                 " changed_at, change_note) VALUES (?, ?, ?, 1, ?, ?, ?, NULL)",
                 (uuid.uuid4().hex, row["user_id"], row["id"], row["label"], row["evidence"], row["created_at"]))


def record_v1(conn: sqlite3.Connection, user_id: str, rule_id: str, label: str, evidence: str | None, at: str) -> None:
    conn.execute("INSERT OR IGNORE INTO j2_journal_rule_versions (id, user_id, rule_id, version, label, evidence,"
                 " changed_at, change_note) VALUES (?, ?, ?, 1, ?, ?, ?, NULL)",
                 (uuid.uuid4().hex, user_id, rule_id, label, evidence, at))


def list_versions(user_id: str, rule_id: str, conn: sqlite3.Connection | None = None) -> list[dict] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _rule_row(conn, user_id, rule_id)
        if row is None:
            return None
        _ensure_v1(conn, row)
        conn.commit()
        rows = conn.execute("SELECT * FROM j2_journal_rule_versions WHERE user_id = ? AND rule_id = ?"
                            " ORDER BY version DESC", (user_id, rule_id)).fetchall()
        return [{"version": r["version"], "label": r["label"], "evidence": r["evidence"],
                 "changedAt": r["changed_at"], "changeNote": r["change_note"]} for r in rows]
    finally:
        if owned:
            conn.close()


def edit_rule(user_id: str, rule_id: str, patch: dict[str, Any], conn: sqlite3.Connection | None = None) -> dict | None:
    from api.services.journal_two import journal_rules
    from api.services.journal_two import notes as notes_service
    owned = conn is None
    conn = conn or get_connection()
    try:
        notes_service._begin_immediate(conn)
        row = _rule_row(conn, user_id, rule_id)
        if row is None:
            conn.rollback()
            return None
        _ensure_v1(conn, row)
        label, evidence = row["label"], row["evidence"]
        if "label" in patch:
            label = (patch.get("label") or "").strip()
            if not label:
                raise RuleEditError("A rule needs words.")
            label = label[:_LABEL_MAX]
        if "evidence" in patch:
            evidence = patch.get("evidence") if isinstance(patch.get("evidence"), str) else None
        now = _now()
        sets, params = ["updated_at = ?"], [now]
        if (label, evidence) != (row["label"], row["evidence"]):
            version = int(row["version"] or 1) + 1
            note = patch.get("changeNote") if isinstance(patch.get("changeNote"), str) else None
            conn.execute("INSERT INTO j2_journal_rule_versions (id, user_id, rule_id, version, label, evidence,"
                         " changed_at, change_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                         (uuid.uuid4().hex, user_id, rule_id, version, label, evidence, now,
                          (note or "").strip()[:_NOTE_MAX] or None))
            sets += ["label = ?", "evidence = ?", "version = ?"]
            params += [label, evidence, version]
        if "beforeEntry" in patch:
            sets.append("before_entry = ?")
            params.append(1 if patch["beforeEntry"] is True else 0)
        conn.execute(f"UPDATE j2_journal_rules SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
                     (*params, rule_id, user_id))
        conn.commit()
        return journal_rules._row_to_dict(_rule_row(conn, user_id, rule_id), conn)
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
```

In `journal_rules.py`: `create_rule` calls `rule_versions.record_v1(conn, user_id, rule_id, clean_label, evidence, now)` before its `conn.commit()`, and its returned dict gains `"beforeEntry": False, "version": 1, "changedAt": now`. `_row_to_dict(row, conn=None)` gains:

```python
    keys = row.keys()
    out["beforeEntry"] = bool(row["before_entry"]) if "before_entry" in keys else False
    out["version"] = int(row["version"]) if "version" in keys and row["version"] is not None else 1
    out["changedAt"] = row["updated_at"] if out["version"] > 1 else row["created_at"]
```

(`changedAt` of the CURRENT version: the version row's `changed_at` equals the `updated_at` written in the same transaction when the words changed. A later before-entry toggle moves `updated_at` but not the version, so read the version row instead when `conn` is given: `conn.execute("SELECT changed_at FROM j2_journal_rule_versions WHERE rule_id = ? AND version = ?", ...)`. Write that read, with the `updated_at` form only as the fallback when no `conn` is passed, and pin it in `test_a_word_change_is_a_version_before_entry_is_not` by asserting `r3["changedAt"] == r2["changedAt"]`.)

- [ ] **Step 4: Purge, manifest, address space**

`account_purge.py`: add `"j2_journal_rule_versions",` to the table list beside `"j2_journal_rules",`. Then:

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/account_deletion_manifest.py --write > "$TEMP/p2b-manifest.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

`address_space.py` `EXEMPT`, beside the P1 rows:

```python
    "j2_journal_rule_versions": "not-a-saved-object: a rule version is history of a rule, reached from the "
                                "rule (Notebook P2)",
```

- [ ] **Step 5: Routes and fixtures**

```python
@router.put("/trader-blocks/rules/{rule_id}")
def trader_edit_rule(rule_id: str, body: dict = Depends(paid_body), user: dict = Depends(require_paid)) -> dict[str, Any]:
    """Spec §P2 item 2. Writes the rule and its version history, never a note."""
    from api.services.journal_two import rule_versions
    try:
        rec = rule_versions.edit_rule(user["id"], rule_id, body)
    except rule_versions.RuleEditError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if rec is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return rec


@router.get("/trader-blocks/rules/{rule_id}/versions")
def trader_rule_versions(rule_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    from api.services.journal_two import rule_versions
    vs = rule_versions.list_versions(user["id"], rule_id)
    if vs is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return {"versions": vs}
```

In the fixtures builder: create a rule for `who`, then record `trader-blocks.rules.edit` (200, label change with a change note), `trader-blocks.rules.edit.before-entry` (200), `trader-blocks.rules.edit.blank` (400), `trader-blocks.rules.versions` (200), `trader-blocks.rules.versions.not-found` (404). Regenerate with `python tools/notebook_contract_fixtures.py`.

- [ ] **Step 6: Run**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_rule_versions.py tests/test_address_space.py tests/test_account_deletion_manifest.py tests/test_notebook_journal_styles_router.py tests/test_notebook_contract_fixtures.py tests/test_journal_rules.py -q > "$TEMP/p2b-t3.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

(`tests/test_journal_rules.py`: `ls tests | grep -i rule` and run every existing rules test file.) Expected: all pass. `test_address_space` may still name pre-existing master offenders (P1's ledger, R25: `agent_conversations`); those stay out of scope, by name.

- [ ] **Step 7: Mutation-prove R-P2b-1**

Capture `rule_versions.py`. Change `if (label, evidence) != (row["label"], row["evidence"]):` to `if True:`. `test_an_unchanged_label_is_no_version` and `test_a_word_change_is_a_version_before_entry_is_not` must FAIL. Restore by bytes; check the sha.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add api/services/journal_two/db.py api/services/journal_two/rule_versions.py api/services/journal_two/journal_rules.py api/services/journal_two/account_purge.py docs/account-deletion-manifest.md api/services/address_space.py api/routers/notebook_journal_styles.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_rule_versions.py
git commit -F - -- api/services/journal_two/db.py api/services/journal_two/rule_versions.py api/services/journal_two/journal_rules.py api/services/journal_two/account_purge.py docs/account-deletion-manifest.md api/services/address_space.py api/routers/notebook_journal_styles.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_rule_versions.py <<'MSG'
feat(journal): rule versions (j2_journal_rule_versions), before-entry rules, the rule edit door

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 4: "Before / after this rule" — the numbers

Spec §P2 item 2; R-P2b-3; Review Focus 1 and 2.

**Files:**
- Modify: `api/services/journal_two/rule_versions.py` (append)
- Modify: `api/routers/notebook_journal_styles.py`, `tools/notebook_contract_fixtures.py`
- Test: `tests/test_rule_before_after.py` (new)

**Interfaces:**
- `rule_versions.SMALL_SAMPLE = 10`.
- `rule_versions.before_after(user_id, rule_id) -> dict | None` → `{"ruleId", "accountId", "versions": [{"version", "label", "changedAt", "before": Window, "after": Window}]}`, newest version first. `Window = {"from": iso|None, "to": iso|None, "trades": int, "wins": int, "winRate": float|None, "rCount": int, "avgR": float|None, "adherenceCount": int, "adherence": float|None, "small": bool}`. `winRate` is `wins/trades` (0-1) when `trades > 0` else None; `small` is `trades < SMALL_SAMPLE`.
- `GET /api/j2/trader-blocks/rules/{rule_id}/before-after`.

- [ ] **Step 1: Failing tests**

`tests/test_rule_before_after.py`:

```python
"""R-P2b-3: windows by version, sample sizes always, never a bare rate under 10 trades."""
from __future__ import annotations

import importlib
import os
import tempfile
import uuid

import pytest


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _trade(day, result, r=None, account="a1", user="u1", excluded=0):
    from api.services.auth_db import get_connection
    c = get_connection()
    tid = uuid.uuid4().hex
    c.execute("INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date, exit_price,"
              " exit_date, original_stop, pnl_dollar, pnl_percent, r_multiple, hold_days, result, context_at_entry,"
              " created_at, account_id, analytics_excluded) VALUES (?, ?, 'p', 'NVDA', 'Long', 1, 100, ?, 101, ?, 95,"
              " 1, 0.01, ?, 1, ?, '{}', 'now', ?, ?)", (tid, user, day, day, r, result, account, excluded))
    c.commit(); c.close()
    return tid


def _rule_with_v2(changed_day):
    from api.services.auth_db import get_connection
    from api.services.journal_two import journal_rules, rule_versions as rv
    r = journal_rules.create_rule("u1", "a1", "Wait 5 minutes")
    c = get_connection()
    c.execute("UPDATE j2_journal_rules SET created_at = '2026-01-01T00:00:00+00:00' WHERE id = ?", (r["id"],))
    c.execute("UPDATE j2_journal_rule_versions SET changed_at = '2026-01-01T00:00:00+00:00' WHERE rule_id = ?", (r["id"],))
    c.commit(); c.close()
    rv.edit_rule("u1", r["id"], {"label": "Wait 15 minutes"})
    c = get_connection()
    c.execute("UPDATE j2_journal_rule_versions SET changed_at = ? WHERE rule_id = ? AND version = 2",
              (f"{changed_day}T14:00:00+00:00", r["id"]))
    c.commit(); c.close()
    return r


def test_windows_split_on_the_change_day(db_path):
    from api.services.journal_two import rule_versions as rv
    r = _rule_with_v2("2026-03-01")
    for d in ("2026-02-10", "2026-02-11"):
        _trade(d, "Loss", -1.0)
    for d in ("2026-03-01", "2026-03-05", "2026-03-06"):
        _trade(d, "Win", 2.0)
    _trade("2026-03-07", "Win", 9.0, excluded=1)                          # excluded from analytics
    _trade("2026-03-08", "Win", 9.0, account="other")                    # another account
    v2 = rv.before_after("u1", r["id"])["versions"][0]
    assert v2["version"] == 2
    assert (v2["before"]["trades"], v2["before"]["wins"], v2["before"]["avgR"]) == (2, 0, -1.0)
    assert (v2["after"]["trades"], v2["after"]["wins"], v2["after"]["avgR"]) == (3, 3, 2.0)
    assert v2["after"]["small"] is True and v2["after"]["winRate"] == 1.0


def test_empty_and_partial_windows_say_so(db_path):
    from api.services.journal_two import rule_versions as rv
    r = _rule_with_v2("2026-03-01")
    _trade("2026-03-02", "Win", None)                                     # no R recorded
    v2 = rv.before_after("u1", r["id"])["versions"][0]
    assert v2["before"] == {**v2["before"], "trades": 0, "winRate": None, "avgR": None, "adherence": None}
    assert (v2["after"]["trades"], v2["after"]["rCount"], v2["after"]["avgR"]) == (1, 0, None)
    assert v2["after"]["adherenceCount"] == 0 and v2["after"]["adherence"] is None


def test_adherence_averages_only_trades_with_a_record(db_path):
    from api.services.journal_two import adherence_store, rule_versions as rv
    r = _rule_with_v2("2026-03-01")
    t1 = _trade("2026-03-02", "Win", 1.0)
    _trade("2026-03-03", "Loss", -1.0)
    adherence_store.upsert_adherence("u1", f"id:{t1}", "VCP", ["a", "b"], 4)
    after = rv.before_after("u1", r["id"])["versions"][0]["after"]
    assert (after["adherenceCount"], after["adherence"]) == (1, 0.5)


def test_versions_and_windows_follow_an_edit(db_path):
    from api.services.journal_two import rule_versions as rv
    r = _rule_with_v2("2026-03-01")
    rv.edit_rule("u1", r["id"], {"label": "Wait 30 minutes"})
    got = rv.before_after("u1", r["id"])
    assert [v["version"] for v in got["versions"]] == [3, 2, 1]
    assert got["versions"][1]["after"]["to"] == got["versions"][0]["changedAt"]


def test_another_members_rule_is_none(db_path):
    from api.services.journal_two import journal_rules, rule_versions as rv
    assert rv.before_after("u1", journal_rules.create_rule("u2", "a1", "x")["id"]) is None
```

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_rule_before_after.py -q > "$TEMP/p2b-t4.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL. (The `INSERT INTO j2_trades` column list must satisfy every NOT NULL column after `_PHASE_2_ALTERS`; read them first and adjust.)

- [ ] **Step 3: Implement**

Append to `rule_versions.py`:

```python
# ── "Before / after this rule" (spec §P2 item 2; R-P2b-3) ───────────────────────────────────
SMALL_SAMPLE = 10


def _day(iso: str | None) -> str | None:
    return iso[:10] if iso else None


def _window(conn, user_id: str, account_id: str | None, frm: str | None, to: str | None, adh: dict) -> dict:
    from api.services.journal_two.trade_refs import trade_ref_for_row
    sql = ["SELECT * FROM j2_trades WHERE user_id = ? AND COALESCE(analytics_excluded, 0) = 0"]
    params: list = [user_id]
    if account_id:
        sql.append("AND account_id = ?"); params.append(account_id)
    if frm:
        sql.append("AND substr(entry_date, 1, 10) >= ?"); params.append(_day(frm))
    if to:
        sql.append("AND substr(entry_date, 1, 10) < ?"); params.append(_day(to))
    rows = conn.execute(" ".join(sql), params).fetchall()
    wins = sum(1 for r in rows if r["result"] == "Win")
    rs = [float(r["r_multiple"]) for r in rows if r["r_multiple"] is not None]
    ad = [adh[ref]["adherencePct"] for ref in (trade_ref_for_row(r) for r in rows) if ref in adh]
    n = len(rows)
    return {"from": frm, "to": to, "trades": n, "wins": wins,
            "winRate": (wins / n) if n else None,
            "rCount": len(rs), "avgR": round(sum(rs) / len(rs), 2) if rs else None,
            "adherenceCount": len(ad), "adherence": round(sum(ad) / len(ad), 4) if ad else None,
            "small": n < SMALL_SAMPLE}


def before_after(user_id: str, rule_id: str, conn: sqlite3.Connection | None = None) -> dict | None:
    from api.services.journal_two import adherence_store
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _rule_row(conn, user_id, rule_id)
        if row is None:
            return None
        _ensure_v1(conn, row)
        conn.commit()
        vs = conn.execute("SELECT * FROM j2_journal_rule_versions WHERE user_id = ? AND rule_id = ?"
                          " ORDER BY version", (user_id, rule_id)).fetchall()
        adh = {a["tradeRef"]: a for a in adherence_store.list_adherence_for_user(user_id, conn=conn)}
        out = []
        for i, v in enumerate(vs):
            prev_start = vs[i - 1]["changed_at"] if i > 0 else None
            nxt = vs[i + 1]["changed_at"] if i + 1 < len(vs) else None
            out.append({"version": v["version"], "label": v["label"], "changedAt": v["changed_at"],
                        "before": _window(conn, user_id, row["account_id"], prev_start, v["changed_at"], adh),
                        "after": _window(conn, user_id, row["account_id"], v["changed_at"], nxt, adh)})
        return {"ruleId": rule_id, "accountId": row["account_id"], "versions": list(reversed(out))}
    finally:
        if owned:
            conn.close()
```

(`adherence_store.list_adherence_for_user`'s signature and record keys (`tradeRef`, `adherencePct`): read `adherence_store.py:38-55` and `:128` first and use what they return. For v1, `before` runs from the start of time to v1's day, as R-P2b-3 says.)

Route:

```python
@router.get("/trader-blocks/rules/{rule_id}/before-after")
def trader_rule_before_after(rule_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    """Read-only. Sample sizes always; `small` below rule_versions.SMALL_SAMPLE (spec §P2 item 2)."""
    from api.services.journal_two import rule_versions
    got = rule_versions.before_after(user["id"], rule_id)
    if got is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return got
```

Fixtures: add two closed trades for `who` around the rule's v2 and record `trader-blocks.rules.before-after` (200) and `.not-found` (404).

- [ ] **Step 4: Run, mutation-prove, commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/notebook_contract_fixtures.py > "$TEMP/p2b-t4-gen.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_rule_before_after.py tests/test_rule_versions.py tests/test_notebook_journal_styles_router.py tests/test_notebook_contract_fixtures.py -q > "$TEMP/p2b-t4.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Mutation: capture `rule_versions.py`; drop the `COALESCE(analytics_excluded, 0) = 0` clause; `test_windows_split_on_the_change_day` must FAIL. Restore by bytes; check the sha.

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add api/services/journal_two/rule_versions.py api/routers/notebook_journal_styles.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_rule_before_after.py
git commit -F - -- api/services/journal_two/rule_versions.py api/routers/notebook_journal_styles.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_rule_before_after.py <<'MSG'
feat(journal): before/after each rule version -- win rate, average R, adherence, sample sizes always

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 5: M-7 — a version restore takes the style stamp back with the body

P1 final review M-7 (`final-review.md`): "`update_note` restores body/properties but not `style_version`, so a note restored to before 'Update layout' still records the newer version and is never offered the update again (only `/style` recovers it)." Part b adds blocks "Update layout" will add, so it is fixed now. Review Focus 3.

**Files:**
- Modify: `api/services/journal_two/db.py` (`_PHASE_2_ALTERS`)
- Modify: `api/services/journal_two/notes.py` (`_maybe_capture_version`'s INSERT, `get_note_version`'s dict, `restore_note_version`, `update_note`'s `style_stamp` type)
- Test: `tests/test_restore_style_stamp.py` (new)

**Interfaces:**
- Columns: `ALTER TABLE j2_note_versions ADD COLUMN style_id TEXT`, `... ADD COLUMN style_version INTEGER`, `... ADD COLUMN style_captured INTEGER NOT NULL DEFAULT 0`.
- A version captured from now on records the note's `style_id`/`style_version` and `style_captured = 1`.
- `restore_note_version` passes `style_stamp` to `update_note`: `(version.styleId, version.styleVersion)` when `styleCaptured`; else `(current style_id, None)` (a legacy version: keep the style, forget the version, so the planner offers the update again).
- `update_note(..., style_stamp: tuple[str | None, int | None] | None = None)`.

- [ ] **Step 1: Failing tests**

`tests/test_restore_style_stamp.py`:

```python
"""P1 M-7: a version restore takes the style stamp back with the body."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _note_updated_to_v2():
    from api.services.journal_two import journal_styles as js, notes
    s = js.create_style("u1", {"name": "S", "kindId": "thesis", "blocks": [],
                               "outlineBodyJson": {"type": "doc", "content": [
                                   {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "T"}]}]}})
    n, _ = js.create_styled_note("u1", {"styleId": s["id"], "ticker": "NVDA"})
    js.update_style("u1", s["id"], {"blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "D"}}]})
    note, _ = js.apply_style_update("u1", n["id"], expected_updated_at=n["updatedAt"])
    return s, n, note


def test_restoring_before_the_update_takes_the_version_back(db_path):
    from api.services.journal_two import journal_styles as js, notes
    s, n, note = _note_updated_to_v2()
    assert note["styleVersion"] == 2
    versions = notes.list_note_versions("u1", n["id"])
    pre = next(v for v in versions if v.get("styleVersion") == 1)
    back = notes.restore_note_version("u1", n["id"], pre["id"], expected_updated_at=note["updatedAt"])
    assert (back["styleId"], back["styleVersion"]) == (s["id"], 1)
    plan = js.plan_style_update("u1", n["id"])
    assert plan["versionCurrent"] is False and plan["missingBlocks"] is True


def test_a_restore_from_a_legacy_version_reoffers_the_update(db_path):
    from api.services.auth_db import get_connection
    from api.services.journal_two import journal_styles as js, notes
    s, n, note = _note_updated_to_v2()
    c = get_connection()
    c.execute("UPDATE j2_note_versions SET style_id = NULL, style_version = NULL, style_captured = 0 WHERE note_id = ?", (n["id"],))
    c.commit(); c.close()
    pre = notes.list_note_versions("u1", n["id"])[-1]
    back = notes.restore_note_version("u1", n["id"], pre["id"], expected_updated_at=note["updatedAt"])
    assert (back["styleId"], back["styleVersion"]) == (s["id"], None)
    assert js.plan_style_update("u1", n["id"])["versionCurrent"] is False


def test_a_note_never_made_from_a_style_restores_with_no_stamp(db_path):
    from api.services.journal_two import notes
    n = notes.create_note("u1", {"title": "plain"})
    n2 = notes.update_note("u1", n["id"], {"title": "plain 2"}, client_schema=4, force_version=True)
    v = notes.list_note_versions("u1", n["id"])[-1]
    back = notes.restore_note_version("u1", n["id"], v["id"], expected_updated_at=n2["updatedAt"])
    assert (back.get("styleId"), back.get("styleVersion")) == (None, None)
```

(`notes.list_note_versions`: use the name Task 4 of part a confirmed. `_note_updated_to_v2` relies on the update being version-captured; if `_maybe_capture_version`'s coalescing window would merge the composer's create and the update into one version row, pass `force_version=True` through the update path in the test by calling `notes.update_note` directly instead of `apply_style_update` for the capture, and read V3 for the window rule.)

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_restore_style_stamp.py -q > "$TEMP/p2b-t5.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL.

- [ ] **Step 3: Implement**

`db.py` `_PHASE_2_ALTERS`, after the `restored_from_version_id` row:

```python
    # Notebook P2 (P1 M-7): a version records the style stamp it was taken at, so a restore takes it back.
    "ALTER TABLE j2_note_versions ADD COLUMN style_id TEXT",
    "ALTER TABLE j2_note_versions ADD COLUMN style_version INTEGER",
    "ALTER TABLE j2_note_versions ADD COLUMN style_captured INTEGER NOT NULL DEFAULT 0",
```

`notes._maybe_capture_version`: extend the INSERT's column list with `style_id, style_version, style_captured` and its values with `existing["style_id"] if "style_id" in existing.keys() else None`, the same for `style_version`, and `1`.

`get_note_version`'s dict (beside `"restoredFromVersionId"`), and the list function's dict if it is a different builder:

```python
            "styleId": row["style_id"] if "style_id" in _row_keys(row) else None,
            "styleVersion": row["style_version"] if "style_version" in _row_keys(row) else None,
            "styleCaptured": bool(row["style_captured"]) if "style_captured" in _row_keys(row) else False,
```

`restore_note_version`, before the `update_note(...)` call:

```python
        # P1 M-7: the stamp goes back with the body. A version taken before this release carries no
        # stamp: keep the style, forget the version, so "Update layout" is offered again.
        current = conn.execute("SELECT style_id FROM j2_notes WHERE id = ? AND user_id = ?",
                               (note_id, user_id)).fetchone()
        if version.get("styleCaptured"):
            stamp = (version.get("styleId"), version.get("styleVersion"))
        else:
            stamp = (current["style_id"] if current else None, None)
```

and pass `style_stamp=stamp if (stamp[0] or (current and current["style_id"])) else None` to `update_note` (a note that never had a style gets no stamp write at all). Change `update_note`'s annotation to `style_stamp: tuple[str | None, int | None] | None = None`; its body already writes both values as given (`sets.append("style_id = ?"); params.append(style_stamp[0])`).

- [ ] **Step 4: Run, mutation-prove, commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_restore_style_stamp.py tests/test_journal_styles_update.py tests/test_journal_two_notes_versions_router.py tests/test_notes_cas_is_atomic.py tests/test_notes_answer_is_the_committed_row.py tests/test_regime_at_write.py -q > "$TEMP/p2b-t5.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Mutation: capture `notes.py`; replace the restore's `style_stamp=...` argument with `style_stamp=None`. `test_restoring_before_the_update_takes_the_version_back` must FAIL. Restore by bytes; check the sha. Also run `app/src/pages/journal-2-0/lib/offline/doorEnumeration.test.js`: `restore_note_version` stays a wrapper of `update_note` and rail ① still names seven functions.

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add api/services/journal_two/db.py api/services/journal_two/notes.py tests/test_restore_style_stamp.py
git commit -F - -- api/services/journal_two/db.py api/services/journal_two/notes.py tests/test_restore_style_stamp.py <<'MSG'
fix(notebook): a version restore takes the style stamp back with the body (P1 M-7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 6: The daily prep pack, server half

Spec §P2 item 6; R-P2b-6; Review Focus 5.

**Files:**
- Modify: `api/services/journal_two/trader_blocks.py` (prep reads, four capturing builders)
- Modify: `api/routers/notebook_journal_styles.py`, `tools/notebook_contract_fixtures.py`
- Test: `tests/test_trader_blocks_prep.py` (new)

**Interfaces:**
- `trader_blocks.PREP_PARTS = ("wire", "earnings", "movers", "levels")` and `PREP_BLOCK = {"wire": "prepWire", "earnings": "prepEarnings", "movers": "prepMovers", "levels": "prepLevels"}`.
- `trader_blocks.prep_part(user_id, part) -> dict`, every answer `{"part", "capturedAt", "missing": str|None, "detail": str|None, ...}` plus:
  - `wire`: `{"headline": str|None, "wireDate": str|None, "regime": str|None, "exposure": float|None, "exposureAsOf": str|None}`
  - `earnings`: `{"asOf": str|None, "bmo": [str], "amc": [str]}` — the member's names only
  - `movers`: `{"items": [{"symbol", "price", "changePct"}], "unquoted": int}` — top 8 by |change|
  - `levels`: `{"cards": [...]}` from `setups_board.build_cards` with cache-only prices, or `{"needs": "the active setups board"}` when `NOTEBOOK_SETUPS_BOARD_ENABLED` is off
- `GET /api/j2/trader-blocks/prep/{part}` (404 for an unknown part).
- Builders capture `prep_part(ctx["user_id"], part)` into `params.snapshot`. The composer's `ctx` gains `"user_id"` (compose already has `user_id`; add it to `ctx` in both `compose` and `_plan`).

- [ ] **Step 1: Failing tests**

`tests/test_trader_blocks_prep.py`:

```python
"""Spec §P2 item 6 (R-P2b-6): each prep part reads caches only and names its gap."""
from __future__ import annotations

import pytest


def test_each_part_labels_its_gap(monkeypatch):
    from api.services import engine
    from api.services.cache import cache
    from api.services.journal_two import regime, trader_blocks as tb
    monkeypatch.setattr(engine, "get_rundown", lambda: {})
    monkeypatch.setattr(regime, "_read_exposure", lambda: None)
    monkeypatch.setattr(cache, "get", lambda key, *a, **k: None)
    monkeypatch.setattr(tb, "_my_names", lambda uid: set())
    monkeypatch.delenv("NOTEBOOK_SETUPS_BOARD_ENABLED", raising=False)
    assert tb.prep_part("u1", "wire")["missing"] == "no_wire"
    assert tb.prep_part("u1", "earnings")["missing"] == "no_earnings_yet"
    assert tb.prep_part("u1", "movers")["missing"] == "no_names"
    assert tb.prep_part("u1", "levels")["needs"] == "the active setups board"


def test_earnings_are_the_members_names_only(monkeypatch):
    from api.services.cache import cache
    from api.services.journal_two import trader_blocks as tb
    monkeypatch.setattr(cache, "get", lambda key, *a, **k: {"bmo": [{"sym": "NVDA"}, {"sym": "XOM"}], "amc": [{"sym": "AMD"}]} if key == "earnings" else None)
    monkeypatch.setattr(tb, "_my_names", lambda uid: {"NVDA", "AMD"})
    got = tb.prep_part("u1", "earnings")
    assert (got["bmo"], got["amc"], got["missing"]) == (["NVDA"], ["AMD"], None)


def test_movers_are_cached_quotes_sorted_by_size(monkeypatch):
    from api.services.journal_two import trader_blocks as tb
    q = {"NVDA": {"price": 100, "change_pct": 3.0}, "AMD": {"price": 50, "change_pct": -5.0}}
    monkeypatch.setattr(tb, "_my_names", lambda uid: {"NVDA", "AMD", "TSLA"})
    monkeypatch.setattr(tb, "_cached_quote", lambda s: q.get(s))
    got = tb.prep_part("u1", "movers")
    assert [i["symbol"] for i in got["items"]] == ["AMD", "NVDA"] and got["unquoted"] == 1


def test_wire_headline_is_the_first_sentence(monkeypatch):
    from api.services import engine
    from api.services.journal_two import regime, trader_blocks as tb
    monkeypatch.setattr(engine, "get_rundown", lambda: {"html": "<p>Tape is firm. Breadth widened.</p>", "date": "2026-10-13"})
    monkeypatch.setattr(regime, "_read_exposure", lambda: {"score": 95, "as_of": "2026-10-13"})
    got = tb.prep_part("u1", "wire")
    assert (got["headline"], got["regime"], got["exposure"]) == ("Tape is firm.", "green", 95.0)


def test_unknown_part_raises():
    from api.services.journal_two import trader_blocks as tb
    with pytest.raises(KeyError):
        tb.prep_part("u1", "nope")
```

(The headline assertion depends on `extract_rundown_speech_text` and `split_sentences` (`rundown_speech.py:75`, `:94`); read both and set the test's HTML so it survives the extractor — e.g. a briefing block the extractor keeps.)

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_trader_blocks_prep.py -q > "$TEMP/p2b-t6.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

- [ ] **Step 3: Implement**

Append to `trader_blocks.py`:

```python
# ── The daily prep pack (spec §P2 item 6; R-P2b-6) ─────────────────────────────────────────
PREP_PARTS = ("wire", "earnings", "movers", "levels")
PREP_BLOCK = {"wire": "prepWire", "earnings": "prepEarnings", "movers": "prepMovers", "levels": "prepLevels"}
MOVERS_MAX = 8


def _my_names(user_id: str) -> set[str]:
    from api.services import calendar_personalization
    try:
        return set(calendar_personalization.get_user_ticker_sets(user_id).get("all_mine") or ())
    except Exception:  # noqa: BLE001 -- never raises, by that module's own contract; belt and braces
        return set()


def _base(part: str) -> dict:
    return {"part": part, "capturedAt": _iso(datetime.now(timezone.utc)), "missing": None, "detail": None}


def _prep_wire(user_id: str) -> dict:
    from api.services import engine
    from api.services.journal_two import regime as regime_mod
    from api.services.rundown_speech import extract_rundown_speech_text, split_sentences
    out = _base("wire")
    r = engine.get_rundown() or {}
    sentences = split_sentences(extract_rundown_speech_text(r.get("html") or "")) if r.get("html") else []
    cur = regime_mod.get_current_regime()
    out.update({"headline": sentences[0] if sentences else None, "wireDate": r.get("date") or None,
                "regime": cur.get("regime"), "exposure": cur.get("score"), "exposureAsOf": cur.get("asOf")})
    if not sentences and cur.get("regime") is None:
        out.update(missing="no_wire", detail="The morning wire has not published yet today.")
    return out


def _prep_earnings(user_id: str) -> dict:
    from api.services.cache import cache
    out = _base("earnings")
    data = cache.get("earnings")                      # engine.EARNINGS_CACHE_KEY; cache only, never a build
    if not data:
        out.update(asOf=None, bmo=[], amc=[], missing="no_earnings_yet",
                   detail="Today's earnings list has not been loaded yet. Capture again in a few minutes.")
        return out
    mine = _my_names(user_id)
    pick = lambda rows: [r.get("sym") for r in (rows or []) if r.get("sym") in mine]  # noqa: E731
    out.update(asOf=data.get("date") or None, bmo=pick(data.get("bmo")), amc=pick(data.get("amc")))
    return out


def _prep_movers(user_id: str) -> dict:
    out = _base("movers")
    names = sorted(_my_names(user_id))
    if not names:
        out.update(items=[], unquoted=0, missing="no_names",
                   detail="Add names to a watchlist, flag them, or hold a position to see them here.")
        return out
    items, unquoted = [], 0
    for s in names:
        q = _cached_quote(s)
        if q and q.get("price") is not None and q.get("change_pct") is not None:
            items.append({"symbol": s, "price": q["price"], "changePct": q["change_pct"]})
        else:
            unquoted += 1
    items.sort(key=lambda i: abs(i["changePct"]), reverse=True)
    out.update(items=items[:MOVERS_MAX], unquoted=unquoted)
    return out


def _prep_levels(user_id: str) -> dict:
    from api.services.auth_db import get_connection
    from api.services.notebook_flags import flag_on
    out = _base("levels")
    if not flag_on("NOTEBOOK_SETUPS_BOARD_ENABLED", False):
        out.update(needs="the active setups board")
        return out
    from api.services.journal_two import setups_board
    conn = get_connection()
    try:
        prices = lambda syms: {s: q for s in syms if (q := _cached_quote(s))}  # noqa: E731 -- cache only
        out.update(cards=setups_board.build_cards(conn, user_id, prices=prices).get("cards", []))
    finally:
        conn.close()
    return out


_PREP = {"wire": _prep_wire, "earnings": _prep_earnings, "movers": _prep_movers, "levels": _prep_levels}


def prep_part(user_id: str, part: str) -> dict:
    return _PREP[part](user_id)


def _prep_builder(part: str):
    def build(block: dict, ctx: dict):
        uid = ctx.get("user_id")
        return _node(PREP_BLOCK[part], {"snapshot": prep_part(uid, part)} if uid else {}, ctx), None
    return build


BUILDERS.update({PREP_BLOCK[p]: _prep_builder(p) for p in PREP_PARTS})
```

(`build_cards`' answer key for the cards and the `prices` map shape: per V4. `NOTEBOOK_SETUPS_BOARD_ENABLED` is read through the one flag parse, `flag_on`, as every Notebook gate is.)

In `journal_styles.compose` and `_plan`, add `"user_id": user_id` to `ctx`.

Route:

```python
@router.get("/trader-blocks/prep/{part}")
def trader_prep(part: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    """Read-only (spec §P2 item 6). Caches only; each gap is named."""
    from api.services.journal_two import trader_blocks
    if part not in trader_blocks.PREP_PARTS:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return trader_blocks.prep_part(user["id"], part)
```

Fixtures: record `trader-blocks.prep.wire`, `.earnings`, `.movers`, `.levels` (200 each, the fixture world's empty caches: the "missing" shapes) and `trader-blocks.prep.unknown` (404).

- [ ] **Step 4: Run, commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/notebook_contract_fixtures.py > "$TEMP/p2b-t6-gen.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_trader_blocks_prep.py tests/test_trader_blocks.py tests/test_trader_blocks_no_note_door.py tests/test_journal_styles_compose.py tests/test_notebook_journal_styles_router.py tests/test_notebook_contract_fixtures.py -q > "$TEMP/p2b-t6.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add api/services/journal_two/trader_blocks.py api/services/journal_two/journal_styles.py api/routers/notebook_journal_styles.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_trader_blocks_prep.py
git commit -F - -- api/services/journal_two/trader_blocks.py api/services/journal_two/journal_styles.py api/routers/notebook_journal_styles.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_trader_blocks_prep.py <<'MSG'
feat(notebook): daily prep pack reads (wire, earnings for my names, movers, key levels), cache only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 7: The post-trade review pack, server half

Spec §P2 item 7; R-P2b-4, R-P2b-5; Review Focus 4.

**Files:**
- Modify: `api/services/journal_two/trader_blocks.py`, `api/routers/notebook_journal_styles.py`, `tools/notebook_contract_fixtures.py`
- Test: `tests/test_trader_blocks_review.py` (new)

**Interfaces:**
- `trader_blocks.trade_review(user_id, trade_id) -> dict | None` → `{"trade": {id, symbol, side, entryDate, exitDate, entryPrice, exitPrice, rMultiple, result, setup, pnlPercent}, "tags": {"mistakes": [str], "emotions": [str]}, "preEntry": {setup, checkedRuleIds, totalRules} | None, "planGrade": <grade_payload> | {"needs": "plan grading"}}`; None when the trade is not the member's.
- `trader_blocks.recent_closed_trades(user_id, limit=20) -> [{id, symbol, exitDate, result}]`.
- Routes: `GET /api/j2/trader-blocks/review/trades`, `GET /api/j2/trader-blocks/review/{trade_id}` (404).

- [ ] **Step 1: Failing tests**

`tests/test_trader_blocks_review.py`:

```python
"""Spec §P2 item 7 (R-P2b-4/5): one read for the review block; the pre-entry ticks carry."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _trade(user="u1", tid="t1"):
    from api.services.auth_db import get_connection
    c = get_connection()
    c.execute("INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date, exit_price,"
              " exit_date, original_stop, pnl_dollar, pnl_percent, r_multiple, hold_days, result, context_at_entry,"
              " created_at, mistake_tags, emotion_tags) VALUES (?, ?, 'p1', 'NVDA', 'Long', 1, 100, '2026-10-01', 110,"
              " '2026-10-05', 95, 10, 0.1, 2.0, 4, 'Win', '{}', 'now', '[\"chased\"]', '[\"calm\"]')", (tid, user))
    c.commit(); c.close()


def test_review_carries_the_trade_tags_and_pre_entry(db_path, monkeypatch):
    from api.services.journal_two import adherence_store, trader_blocks as tb
    monkeypatch.delenv("NOTEBOOK_PLAN_GRADING_ENABLED", raising=False)
    _trade()
    adherence_store.upsert_adherence("u1", "pos:p1", "VCP", ["s1"], 3)
    got = tb.trade_review("u1", "t1")
    assert got["trade"]["symbol"] == "NVDA" and got["trade"]["rMultiple"] == 2.0
    assert got["tags"] == {"mistakes": ["chased"], "emotions": ["calm"]}
    assert got["preEntry"]["checkedRuleIds"] == ["s1"] and got["preEntry"]["totalRules"] == 3
    assert got["planGrade"] == {"needs": "plan grading"}


def test_review_of_a_missing_trade_is_404(db_path):
    from api.services.journal_two import trader_blocks as tb
    _trade(user="u2")
    assert tb.trade_review("u1", "t1") is None
    assert tb.trade_review("u1", "gone") is None


def test_recent_closed_trades(db_path):
    from api.services.journal_two import trader_blocks as tb
    _trade(tid="t1"); _trade(tid="t2")
    got = tb.recent_closed_trades("u1")
    assert {t["id"] for t in got} == {"t1", "t2"} and set(got[0]) == {"id", "symbol", "exitDate", "result"}
```

- [ ] **Step 2: Run to see them fail; implement**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_trader_blocks_review.py -q > "$TEMP/p2b-t7.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Append to `trader_blocks.py`:

```python
# ── The post-trade review pack (spec §P2 item 7; R-P2b-4, R-P2b-5) ──────────────────────────
_TRADE_KEYS = ("id", "symbol", "side", "entryDate", "exitDate", "entryPrice", "exitPrice", "rMultiple",
               "result", "setup", "pnlPercent")


def recent_closed_trades(user_id: str, limit: int = 20) -> list[dict]:
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        rows = c.execute("SELECT id, symbol, exit_date, result FROM j2_trades WHERE user_id = ?"
                         " ORDER BY exit_date DESC, rowid DESC LIMIT ?", (user_id, int(limit))).fetchall()
        return [{"id": r["id"], "symbol": r["symbol"], "exitDate": r["exit_date"], "result": r["result"]} for r in rows]
    finally:
        c.close()


def trade_review(user_id: str, trade_id: str) -> dict | None:
    from api.services.auth_db import get_connection
    from api.services.journal_two import adherence_store, plan_grading
    from api.services.journal_two import trades as trades_service
    detail = trades_service.get_trade_detail(user_id, trade_id)
    if detail is None:
        return None
    pre = adherence_store.get_adherence(user_id, detail["tradeRef"])
    if pre is None and detail.get("positionId"):
        pre = adherence_store.get_adherence(user_id, PRE_ENTRY_PREFIX + str(detail["positionId"]))
    if plan_grading.enabled():
        c = get_connection()
        try:
            t = plan_grading.get_trade(c, user_id, trade_id)
            grade = plan_grading.grade_payload(c, user_id, t) if t is not None else None
        finally:
            c.close()
    else:
        grade = {"needs": "plan grading"}
    return {"trade": {k: detail.get(k) for k in _TRADE_KEYS},
            "tags": {"mistakes": detail.get("mistakeTags") or [], "emotions": detail.get("emotionTags") or []},
            "preEntry": ({"setup": pre.get("setup"), "checkedRuleIds": pre.get("checkedRuleIds") or [],
                          "totalRules": pre.get("totalRules") or 0} if pre else None),
            "planGrade": grade}
```

Routes (`/review/trades` declared BEFORE `/review/{trade_id}`, so `trades` is never read as an id):

```python
@router.get("/trader-blocks/review/trades")
def trader_review_trades(user: dict = Depends(require_paid)) -> dict[str, Any]:
    from api.services.journal_two import trader_blocks
    return {"trades": trader_blocks.recent_closed_trades(user["id"])}


@router.get("/trader-blocks/review/{trade_id}")
def trader_review(trade_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    """Read-only (spec §P2 item 7). The review block reads its linked trade here."""
    from api.services.journal_two import trader_blocks
    got = trader_blocks.trade_review(user["id"], trade_id)
    if got is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return got
```

`tradeReview`'s builder stays Task 2's empty one (`tradeId: ""`, the member picks the trade). Fixtures: `trader-blocks.review.trades` (200), `trader-blocks.review` (200), `trader-blocks.review.not-found` (404). A route-order test in `tests/test_trader_blocks_review.py`: `GET /api/j2/trader-blocks/review/trades` answers the list, never a 404 for a trade named "trades".

- [ ] **Step 3: Run, commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/notebook_contract_fixtures.py > "$TEMP/p2b-t7-gen.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_trader_blocks_review.py tests/test_trader_blocks_no_note_door.py tests/test_notebook_journal_styles_router.py tests/test_notebook_contract_fixtures.py -q > "$TEMP/p2b-t7.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add api/services/journal_two/trader_blocks.py api/routers/notebook_journal_styles.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_trader_blocks_review.py
git commit -F - -- api/services/journal_two/trader_blocks.py api/routers/notebook_journal_styles.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_trader_blocks_review.py <<'MSG'
feat(notebook): post-trade review read (trade, tags, pre-entry ticks, plan grade or what it needs)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 8: My rules block and the rule editor

Spec §P2 item 2 ("Shows your active rules ... rules gain 'v3 · changed Oct 2'").

**Files:**
- Create: `app/src/pages/journal-2-0/lib/blocks/rulesApi.js`, `rulesApi.test.js`
- Replace: `app/src/pages/journal-2-0/components/notebook/blocks/MyRulesBlock.jsx`; test `MyRulesBlock.test.jsx`
- Modify: `app/src/pages/journal-2-0/lib/blocks/blockDoors.test.js` (`WRITE_EXCEPTIONS`)

**Interfaces:**
- `rulesApi.editRule(ruleId, patch) -> Promise<{ok, rule?, error?}>` (PUT `/api/j2/trader-blocks/rules/{id}`); `rulesApi.versionLine(rule) -> "v3 · changed Oct 2"` (ET date, `MMM D`).
- The block: the selected account's active rules (`useJournalRules(accountId)`), each with its version line, a "Before entry" switch (`role="switch"`, named "Check '<label>' before entry"), and "Edit" opening an inline form (label, evidence, "What changed?" note; Save/Cancel). After a save it calls the hook's `mutate` so the list and the checklist (part a Task 7) see the change. No note write; `params` stays `{}`.

- [ ] **Step 1: Failing tests**

`rulesApi.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { editRule, versionLine } from './rulesApi'

describe('rulesApi', () => {
  it('versionLine reads the version and the ET day it changed', () => {
    expect(versionLine({ version: 3, changedAt: '2026-10-02T15:00:00+00:00' })).toBe('v3 · changed Oct 2')
    expect(versionLine({ version: 1, changedAt: '2026-01-02T00:00:00+00:00' })).toBe('v1 · made Jan 1')
  })
  it('editRule PUTs to the rule route and reports the server sentence on 400', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ detail: 'A rule needs words.' }) }))
    expect(await editRule('r1', { label: '' })).toEqual({ ok: false, error: 'A rule needs words.' })
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trader-blocks/rules/r1', expect.objectContaining({ method: 'PUT' }))
  })
})
```

(`2026-01-02T00:00:00+00:00` is Jan 1 in ET: the line uses `America/New_York`, the test proves it.)

`MyRulesBlock.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const mutate = vi.fn()
let RULES = [{ id: 'r1', label: 'Wait 15 minutes', evidence: null, version: 2, changedAt: '2026-10-02T15:00:00+00:00', beforeEntry: false }]
vi.mock('../../../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1' }) }))
vi.mock('../../../hooks/useJournalRules', () => ({ default: () => ({ rules: RULES, mutate }) }))
import MyRulesBlock from './MyRulesBlock'

describe('MyRulesBlock', () => {
  it('lists rules with their version line', () => {
    render(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    expect(screen.getByText('Wait 15 minutes')).toBeTruthy()
    expect(screen.getByText('v2 · changed Oct 2')).toBeTruthy()
  })
  it('the before-entry switch saves the rule, never the note', async () => {
    const setParams = vi.fn()
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ...RULES[0], beforeEntry: true }) }))
    render(<MyRulesBlock params={{}} setParams={setParams} editable />)
    fireEvent.click(screen.getByRole('switch', { name: "Check 'Wait 15 minutes' before entry" }))
    await waitFor(() => expect(mutate).toHaveBeenCalled())
    expect(setParams).not.toHaveBeenCalled()
  })
  it('no rules: says how to make one', () => {
    RULES = []
    render(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    expect(screen.getByText(/You have no rules yet/)).toBeTruthy()
  })
})
```

The `useJournalRules` hook returns `mutate`? It returns `{rules, isLoading, error, create, dismiss}` (its docstring); add `mutate` to its return (one line, `return { rules, isLoading, error, mutate, create, dismiss }`) and a case in its own test file if one exists.

- [ ] **Step 2: Run to see them fail; implement**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/lib/blocks/rulesApi.test.js src/pages/journal-2-0/components/notebook/blocks/MyRulesBlock.test.jsx > "$TEMP/p2b-t8.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

`rulesApi.js`:

```js
// The rule edit door (part b Task 3). It writes RULES, never a note: lib/blocks/blockDoors.test.js names
// this file in WRITE_EXCEPTIONS with that reason.
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })

export function versionLine(rule) {
  const v = Number(rule?.version) || 1
  const day = rule?.changedAt ? DAY.format(new Date(rule.changedAt)) : ''
  return `v${v} · ${v > 1 ? 'changed' : 'made'} ${day}`.trim()
}

export async function editRule(ruleId, patch) {
  try {
    const res = await fetch(`/api/j2/trader-blocks/rules/${encodeURIComponent(ruleId)}`, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: typeof data?.detail === 'string' ? data.detail : 'The rule could not be saved. Nothing changed.' }
    return { ok: true, rule: data }
  } catch {
    return { ok: false, error: 'You are offline. The rule was not saved.' }
  }
}
```

`MyRulesBlock.jsx`: the list (each `<li>`: the label, the version line in `styles.muted`, the before-entry switch, an "Edit" button), the inline edit form (labelled inputs "Rule", "Why" for evidence, "What changed?" for the change note; Save calls `editRule(id, {label, evidence, changeNote})` then `mutate()`; an error shows its sentence in `role="status"`), and the empty state `"You have no rules yet. Turn a recurring mistake into a rule from Insights, then it shows here."`. No `setParams` call anywhere in this block (its params stay `{}`). Write it in full with the part-a `Blocks.module.css` classes and 44 px targets.

In `blockDoors.test.js` `WRITE_EXCEPTIONS`, add:

```js
  'app/src/pages/journal-2-0/lib/blocks/rulesApi.js':
    'PUT /api/j2/trader-blocks/rules/{id} writes j2_journal_rules and j2_journal_rule_versions (part b '
    + 'Task 3), never a note.',
```

- [ ] **Step 3: Run, commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/components/notebook/blocks src/pages/journal-2-0/components/insights/MyRulesList.test.jsx src/styles/tapFloor.test.js > "$TEMP/p2b-t8.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/lib/blocks/rulesApi.js app/src/pages/journal-2-0/lib/blocks/rulesApi.test.js app/src/pages/journal-2-0/lib/blocks/blockDoors.test.js app/src/pages/journal-2-0/components/notebook/blocks/MyRulesBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/MyRulesBlock.test.jsx app/src/pages/journal-2-0/hooks/useJournalRules.js
git commit -F - -- app/src/pages/journal-2-0/lib/blocks/rulesApi.js app/src/pages/journal-2-0/lib/blocks/rulesApi.test.js app/src/pages/journal-2-0/lib/blocks/blockDoors.test.js app/src/pages/journal-2-0/components/notebook/blocks/MyRulesBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/MyRulesBlock.test.jsx app/src/pages/journal-2-0/hooks/useJournalRules.js <<'MSG'
feat(notebook): My rules block -- version lines, before-entry switch, the rule editor (writes rules, never the note)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 9: Insights — "Before / after this rule"

Spec §P2 item 2; R-P2b-3; Review Focus 2.

**Files:**
- Create: `app/src/pages/journal-2-0/components/insights/RuleBeforeAfterCard.jsx`, `.module.css`, `RuleBeforeAfterCard.test.jsx`
- Create: `app/src/pages/journal-2-0/lib/blocks/beforeAfterText.js`, `beforeAfterText.test.js`
- Modify: `app/src/pages/journal-2-0/components/insights/PsychologySection.jsx` (mount it, lazy, under `MyRulesList`, while `journalStylesEnabled()`)

**Interfaces:**
- `beforeAfterText.windowLines(win) -> {winRate, avgR, adherence}`, each a sentence. `trades === 0` → `"No trades"`; `win.small` → `"4 of 7 won (too few trades to read as a rate)"`; else `"62% won (13 of 21 trades)"`. `avgR`: `"No R recorded"` when `rCount === 0`, else `"+1.40 R average (over 18 trades)"`. `adherence`: `"No checklist record"` when `adherenceCount === 0`, else `"80% of checklist items followed (over 9 trades)"` — the adherence percentage is shown with its count, and under 10 records it reads `"… (only 6 trades: too few to read as a rate)"`.
- The card: a rule picker (`<select>` named "Rule"), then one section per version (newest first) with BEFORE and AFTER columns and the version's words. On a phone the two columns stack.

- [ ] **Step 1: Failing tests**

`beforeAfterText.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { windowLines } from './beforeAfterText'

const w = (o) => ({ trades: 0, wins: 0, winRate: null, rCount: 0, avgR: null, adherenceCount: 0, adherence: null, small: true, ...o })

describe('windowLines (spec: never a percentage on fewer than 10 trades without saying so)', () => {
  it('empty', () => {
    expect(windowLines(w({}))).toEqual({ winRate: 'No trades', avgR: 'No R recorded', adherence: 'No checklist record' })
  })
  it('small: counts, and says why there is no rate', () => {
    expect(windowLines(w({ trades: 7, wins: 4, winRate: 4 / 7 })).winRate).toBe('4 of 7 won (too few trades to read as a rate)')
  })
  it('enough: a rate with its sample', () => {
    const l = windowLines(w({ trades: 21, wins: 13, winRate: 13 / 21, small: false, rCount: 18, avgR: 1.4, adherenceCount: 12, adherence: 0.8 }))
    expect(l).toEqual({ winRate: '62% won (13 of 21 trades)', avgR: '+1.40 R average (over 18 trades)',
      adherence: '80% of checklist items followed (over 12 trades)' })
  })
  it('adherence under 10 records says so', () => {
    expect(windowLines(w({ trades: 30, small: false, adherenceCount: 6, adherence: 0.5 })).adherence)
      .toBe('50% of checklist items followed (only 6 trades: too few to read as a rate)')
  })
})
```

`RuleBeforeAfterCard.test.jsx`: mock `useJournalRules` (two rules) and `fetch` (`/before-after` answering two versions); assert the "Rule" select lists both, the newest version's words show first, each window's three lines render from `windowLines`, a 404 renders "This rule could not be read. It may have been dismissed.", and with the switch off (`journalStylesEnabled` mocked false) `PsychologySection` does not mount the card. Write the cases in full.

- [ ] **Step 2: Run to see them fail; implement**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/lib/blocks/beforeAfterText.test.js src/pages/journal-2-0/components/insights/RuleBeforeAfterCard.test.jsx > "$TEMP/p2b-t9.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

`beforeAfterText.js`:

```js
// "Before / after this rule" sentences (spec §P2 item 2; R-P2b-3). The server marks `small` below 10
// trades (rule_versions.SMALL_SAMPLE); this file never prints a bare percentage for a small sample.
const SMALL = 10
const pct = (x) => `${Math.round(x * 100)}%`

export function windowLines(win) {
  const n = win?.trades || 0
  const winRate = !n ? 'No trades'
    : win.small ? `${win.wins} of ${n} won (too few trades to read as a rate)`
    : `${pct(win.winRate)} won (${win.wins} of ${n} trades)`
  const avgR = !win?.rCount ? 'No R recorded'
    : `${win.avgR > 0 ? '+' : ''}${Number(win.avgR).toFixed(2)} R average (over ${win.rCount} trades)`
  const a = win?.adherenceCount || 0
  const adherence = !a ? 'No checklist record'
    : a < SMALL ? `${pct(win.adherence)} of checklist items followed (only ${a} trades: too few to read as a rate)`
    : `${pct(win.adherence)} of checklist items followed (over ${a} trades)`
  return { winRate, avgR, adherence }
}
```

(`SMALL` here and `rule_versions.SMALL_SAMPLE` are one fact in two files: add `tests/test_rule_before_after.py::test_the_client_small_sample_is_the_servers`, which reads `^const SMALL = (\d+)$` from `beforeAfterText.js` (exactly one match, non-vacuity) and compares it to `rule_versions.SMALL_SAMPLE`.)

`RuleBeforeAfterCard.jsx`: `useJ2SelectedAccount` → `accountId`; `useJournalRules(accountId)`; a `<select aria-label="Rule">`; SWR on `/api/j2/trader-blocks/rules/{id}/before-after`; one `<section aria-label={`Version ${v.version}`}>` per version, a two-column grid (`Before` / `After`) of the three `windowLines` sentences, and the version's words and day. Mount in `PsychologySection.jsx` under `<MyRulesList …/>`:

```jsx
      {journalStylesEnabled() && accountId && (
        <Suspense fallback={null}><RuleBeforeAfterCard accountId={accountId} /></Suspense>
      )}
```

with `const RuleBeforeAfterCard = lazyChunk(() => import('./RuleBeforeAfterCard'))` at module scope.

- [ ] **Step 3: Run, commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/components/insights src/styles/tapFloor.test.js src/components/screener/reachable.test.js > "$TEMP/p2b-t9.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_rule_before_after.py -q > "$TEMP/p2b-t9-py.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/lib/blocks/beforeAfterText.js app/src/pages/journal-2-0/lib/blocks/beforeAfterText.test.js app/src/pages/journal-2-0/components/insights/RuleBeforeAfterCard.jsx app/src/pages/journal-2-0/components/insights/RuleBeforeAfterCard.module.css app/src/pages/journal-2-0/components/insights/RuleBeforeAfterCard.test.jsx app/src/pages/journal-2-0/components/insights/PsychologySection.jsx tests/test_rule_before_after.py
git commit -F - -- app/src/pages/journal-2-0/lib/blocks/beforeAfterText.js app/src/pages/journal-2-0/lib/blocks/beforeAfterText.test.js app/src/pages/journal-2-0/components/insights/RuleBeforeAfterCard.jsx app/src/pages/journal-2-0/components/insights/RuleBeforeAfterCard.module.css app/src/pages/journal-2-0/components/insights/RuleBeforeAfterCard.test.jsx app/src/pages/journal-2-0/components/insights/PsychologySection.jsx tests/test_rule_before_after.py <<'MSG'
feat(journal): Insights "Before / after this rule" -- sample sizes always, no bare rate under 10 trades

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 10: The four prep blocks

Spec §P2 item 6; R-P2b-6.

**Files:**
- Create: `app/src/pages/journal-2-0/components/notebook/blocks/PrepCapture.jsx` (shared capture/frozen frame)
- Replace: `PrepWireBlock.jsx`, `PrepEarningsBlock.jsx`, `PrepMoversBlock.jsx`, `PrepLevelsBlock.jsx`
- Test: `app/src/pages/journal-2-0/components/notebook/blocks/PrepBlocks.test.jsx`

**Interfaces:**
- `PrepCapture({ part, params, setParams, editable, children(snapshot) })`: no snapshot → "Capture now" (GET `/api/j2/trader-blocks/prep/{part}`, then `setParams({ snapshot })`); a snapshot → `children(snapshot)`, "Captured {time} ET" and "Capture again". A snapshot with `missing` shows its `detail`; with `needs` shows `BlockNeedsSwitch({ what: needs })`. Never fetches on mount.
- Each body renders its part: wire → the headline, "Exposure {score} ({Regime word})", the wire date; earnings → "Before the open: NVDA, AMD" / "After the close: …" / "None of your names report today."; movers → a list "AMD −5.0% at 50.00", plus "{n} of your names had no quote"; levels → one line per card (symbol, the nearest level and its distance, the shape V4 recorded).

- [ ] **Step 1: Failing tests**

`PrepBlocks.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PrepWireBlock from './PrepWireBlock'
import PrepEarningsBlock from './PrepEarningsBlock'
import PrepMoversBlock from './PrepMoversBlock'
import PrepLevelsBlock from './PrepLevelsBlock'

const at = '2026-10-13T12:30:00Z'

describe('prep blocks', () => {
  beforeEach(() => { globalThis.fetch = vi.fn() })

  it('Capture now reads the part and freezes it through setParams; never on mount', async () => {
    const snap = { part: 'wire', capturedAt: at, headline: 'Tape is firm.', regime: 'green', exposure: 95 }
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => snap }))
    const setParams = vi.fn(() => true)
    render(<PrepWireBlock params={{}} setParams={setParams} editable />)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Capture now' }))
    await waitFor(() => expect(setParams).toHaveBeenCalledWith({ snapshot: snap }))
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trader-blocks/prep/wire', expect.anything())
  })
  it('each gap is named', () => {
    render(<PrepEarningsBlock params={{ snapshot: { part: 'earnings', capturedAt: at, missing: 'no_earnings_yet', detail: "Today's earnings list has not been loaded yet. Capture again in a few minutes.", bmo: [], amc: [] } }} setParams={vi.fn()} editable />)
    expect(screen.getByText(/has not been loaded yet/)).toBeTruthy()
    render(<PrepLevelsBlock params={{ snapshot: { part: 'levels', capturedAt: at, needs: 'the active setups board' } }} setParams={vi.fn()} editable />)
    expect(screen.getByText('This block needs the active setups board, which is not on for you.')).toBeTruthy()
  })
  it('earnings and movers read as sentences', () => {
    render(<PrepEarningsBlock params={{ snapshot: { part: 'earnings', capturedAt: at, bmo: ['NVDA'], amc: [] } }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Before the open: NVDA')).toBeTruthy()
    render(<PrepMoversBlock params={{ snapshot: { part: 'movers', capturedAt: at, items: [{ symbol: 'AMD', price: 50, changePct: -5 }], unquoted: 2 } }} setParams={vi.fn()} editable />)
    expect(screen.getByText('AMD −5.0% at 50.00')).toBeTruthy()
    expect(screen.getByText('2 of your names had no quote.')).toBeTruthy()
  })
  it('a frozen block says when, and offers Capture again', () => {
    render(<PrepWireBlock params={{ snapshot: { part: 'wire', capturedAt: at, headline: 'x', regime: null } }} setParams={vi.fn()} editable />)
    expect(screen.getByText(/Captured/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Capture again' })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to see them fail; implement**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/components/notebook/blocks/PrepBlocks.test.jsx > "$TEMP/p2b-t10.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

`PrepCapture.jsx`:

```jsx
import { useState } from 'react'
import { BlockNeedsSwitch } from './blockStates'
import styles from './Blocks.module.css'

const FAILED = "This couldn't be read just now. Nothing was changed."

export default function PrepCapture({ part, params, setParams, editable, children }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const snap = params.snapshot
  const capture = async () => {
    setBusy(true); setFailed(false)
    try {
      const res = await fetch(`/api/j2/trader-blocks/prep/${part}`, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      setParams({ snapshot: await res.json() })
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  const when = snap?.capturedAt
    ? new Date(snap.capturedAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })
    : null
  return (
    <div>
      {snap?.needs ? <BlockNeedsSwitch what={snap.needs} />
        : snap?.missing ? <p className={styles.muted}>{snap.detail}</p>
        : snap ? children(snap) : null}
      {when && <p className={styles.muted}>{`Captured ${when} ET`}</p>}
      {failed && <p role="status" className={styles.muted}>{FAILED}</p>}
      {editable && (
        <button type="button" className={`btn btn-ghost ${styles.tap}`} disabled={busy} onClick={capture}>
          {snap ? 'Capture again' : 'Capture now'}
        </button>
      )}
    </div>
  )
}
```

Each body is `PrepCapture` with its part and a `children` renderer, e.g. `PrepMoversBlock.jsx`:

```jsx
import PrepCapture from './PrepCapture'
import styles from './Blocks.module.css'

const line = (i) => `${i.symbol} ${i.changePct < 0 ? '−' : '+'}${Math.abs(i.changePct).toFixed(1)}% at ${Number(i.price).toFixed(2)}`

export default function PrepMoversBlock(props) {
  return (
    <PrepCapture part="movers" {...props}>
      {(s) => (
        <>
          <ul>{(s.items || []).map((i) => <li key={i.symbol}>{line(i)}</li>)}</ul>
          {s.unquoted > 0 && <p className={styles.muted}>{`${s.unquoted} of your names had no quote.`}</p>}
        </>
      )}
    </PrepCapture>
  )
}
```

Write `PrepWireBlock` (headline; `Exposure {Math.round(exposure)} ({REGIME_WORDS[regime]})` using part a's `REGIME_WORDS` from `lib/blocks/marketContextFields.js`; the wire date), `PrepEarningsBlock` (the three sentences above), and `PrepLevelsBlock` (one `<li>` per card, from V4's card shape) in the same form.

- [ ] **Step 3: Run, commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/components/notebook/blocks src/pages/journal-2-0/lib/blocks > "$TEMP/p2b-t10.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/components/notebook/blocks
git commit -F - -- app/src/pages/journal-2-0/components/notebook/blocks <<'MSG'
feat(notebook): daily prep pack blocks -- wire and exposure, earnings for my names, movers, key levels (frozen on capture)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 11: The post-trade review block

Spec §P2 item 7; R-P2b-4, R-P2b-5; Review Focus 4.

**Files:**
- Replace: `app/src/pages/journal-2-0/components/notebook/blocks/TradeReviewBlock.jsx`
- Test: `TradeReviewBlock.test.jsx`

**Interfaces:**
- params `{ tradeId }`. No trade → a `<select aria-label="Trade to review">` of `GET /api/j2/trader-blocks/review/trades` (`"NVDA · closed Oct 5 · Win"`), choosing calls `setParams({ tradeId })`. A trade → `GET /api/j2/trader-blocks/review/{tradeId}`: the trade card (symbol, side, entry → exit, result, R), the plan-vs-execution grade (from `planGrade`, or `BlockNeedsSwitch({what: 'plan grading'})`), the tags ("Mistakes: chased" / "Emotions: calm" / "No tags yet. Add them on the trade's page.", with a `<Link>` to the trade page), and "Not ticked before entry: …" using `uncheckedItems(checklistItems({settings, rules: [], setup: preEntry.setup, includeRules: 'no'}), preEntry.checkedRuleIds)` from part a. 404 → "This trade is no longer in your journal." plus "Pick another trade" (clears `tradeId`).

- [ ] **Step 1: Failing tests**

`TradeReviewBlock.test.jsx` (mock `useJ2Settings` with `setupRules.VCP = [{id:'s1',label:'Volume dry-up'},{id:'s2',label:'Tight closes'}]`, and `fetch` per URL):

- "picks a trade through setParams" — no `tradeId`: the select lists the trades from `/review/trades`; choosing one calls `setParams({ tradeId: 't1' })`.
- "shows the card, the grade or what it needs, the tags and the unticked items" — `/review/t1` answers the Task 7 shape with `preEntry {setup: 'VCP', checkedRuleIds: ['s1'], totalRules: 2}` and `planGrade {needs: 'plan grading'}`; assert `NVDA`, `This block needs plan grading, which is not on for you.`, `Mistakes: chased`, `Not ticked before entry: Tight closes`.
- "trade gone" — `/review/t1` answers 404: `This trade is no longer in your journal.`; "Pick another trade" calls `setParams({ tradeId: '' })`.
- "a reader sees the card, no picker" — `editable={false}`, no `tradeId`: `No trade linked yet.` and no select.

Write each case in full.

- [ ] **Step 2: Run to see them fail; implement; run; commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/components/notebook/blocks/TradeReviewBlock.test.jsx > "$TEMP/p2b-t11.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Implement `TradeReviewBlock.jsx` with `useSWR` reads of the two routes (the same `fetcher` idiom as `useJournalRules.js`), part a's `checklistItems`/`uncheckedItems`, `BlockNeedsSwitch`, `BlockEmpty`, and the `Blocks.module.css` classes. The trade page link: the Journal's trade route (read `grep -rn "path=\"trades/:" app/src/pages/journal-2-0` or the route `TradeDetailPage` is mounted at) — a `<Link>` named "Open the trade".

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/components/notebook/blocks src/pages/journal-2-0/lib/blocks src/styles/tapFloor.test.js > "$TEMP/p2b-t11.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/components/notebook/blocks/TradeReviewBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/TradeReviewBlock.test.jsx
git commit -F - -- app/src/pages/journal-2-0/components/notebook/blocks/TradeReviewBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/TradeReviewBlock.test.jsx <<'MSG'
feat(notebook): post-trade review block -- trade card, plan grade, tags, the unticked pre-entry items

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 12: Daily prep v2, Post-trade review v2, and six slash items

**Files:**
- Modify: `api/services/journal_two/journal_styles.py` (`BUILTIN_STYLES["daily_prep"]`, `["post_trade_review"]`)
- Modify: `app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx` (the part-a block id list; `TRADING_BLOCKS`)
- Test: `tests/test_journal_styles_compose.py`, `SlashMenu.blocks.test.jsx`

- [ ] **Step 1: Failing tests**

`tests/test_journal_styles_compose.py`:

```python
def test_daily_prep_v2_and_review_v2_hold_their_packs(db_path):
    from api.services.journal_two import journal_styles as js
    dp, pr = js.BUILTIN_STYLES["daily_prep"], js.BUILTIN_STYLES["post_trade_review"]
    assert dp["version"] == 2 and [b["block"] for b in dp["blocks"]] == [
        "prepWire", "marketContext", "prepEarnings", "prepMovers", "prepLevels", "myRules"]
    assert pr["version"] == 2 and [b["block"] for b in pr["blocks"]] == ["chart", "tradeReview"]
```

In `SlashMenu.blocks.test.jsx`, extend `titles` with the six part-b labels. Run; expect FAIL.

- [ ] **Step 2: Implement**

```python
    "daily_prep": {"name": "Daily prep", "version": 2, "properties": {},
                   "blocks": [_blk("prepWire"), _blk("marketContext"), _blk("prepEarnings"), _blk("prepMovers"),
                              _blk("prepLevels"), _blk("myRules")],
                   "outline": _doc(
        _h("The market"), _ph("prepWire"), _ph("marketContext"), _p("What is the tape telling me today?"),
        _h("Names on my list"), _ph("prepEarnings"), _ph("prepMovers"), _ph("prepLevels"),
        _p("Which setups are closest to a trigger?"),
        _h("My plan"), _ph("myRules"), _p("What will I do, and what will I not do?"))},
```

```python
    "post_trade_review": {"name": "Post-trade review", "version": 2, "properties": {},
                          "blocks": [_chart("D"), _blk("tradeReview")],
                          "outline": _doc(
        _h("What happened"), _ph("tradeReview"), _p("Entry, exit and result:"), _ph("chart"),
        _h("Did I follow my plan?"), _p("Where did I follow it, and where did I not?"),
        _h("What I'd do differently"), _p())},
```

In `SlashMenu.jsx`, extend the part-a id list to the ten ids and `TRADING_BLOCKS` with the six labels.

- [ ] **Step 3: Run, regenerate fixtures, commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/notebook_contract_fixtures.py > "$TEMP/p2b-t12-gen.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_journal_styles_compose.py tests/test_journal_styles_store.py tests/test_journal_styles_update.py tests/test_notebook_contract_fixtures.py -q > "$TEMP/p2b-t12.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/components/notebook/SlashMenu.blocks.test.jsx src/pages/journal-2-0/components/notebook/SlashMenu.test.jsx src/pages/journal-2-0/components/notebook/styles src/pages/journal-2-0/lib/journalStyles.test.js > "$TEMP/p2b-t12-js.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Read every changed fixture's diff (the two style versions and their blocks) before committing.

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add api/services/journal_two/journal_styles.py app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx app/src/pages/journal-2-0/components/notebook/SlashMenu.blocks.test.jsx tests/test_journal_styles_compose.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract
git commit -F - -- api/services/journal_two/journal_styles.py app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx app/src/pages/journal-2-0/components/notebook/SlashMenu.blocks.test.jsx tests/test_journal_styles_compose.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract <<'MSG'
feat(notebook): Daily prep v2 and Post-trade review v2 carry their packs; six more blocks in the slash menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 13: Walk steps, door rows, bytes, typing with one of every block

**Files:**
- Modify: `tools/notebook_fin_walk_features.py` (part a's `blocks()` step gains rows)
- Modify: `tools/notebook_door_audit_doors.json` (rows 61 and 63, those the audit can drive)
- Modify: `tools/notebook_perf_harness.py` (`--with-blocks` seeds all ten kinds)
- Modify: `tests/test_notebook_fin_walk_styles_step.py`
- Create: `docs/notebook/evidence/fin-walk/<tip>/c2/`, `docs/notebook/evidence/door-audit-<stamp>/`, `docs/notebook/perf-runs/p2b/`

**Interfaces:**
- New walk features, waiters only (`wait_for`, `C.vis_loc`, `save_landed`):
  - `blocks.my-rules` (1280, 390): a rule made through `POST /api/j2/accounts/{id}/rules`; the block shows "v1 · made …"; Edit → new words and a change note → Save; the line reads "v2 · changed …"; the before-entry switch on; a part-a checklist block in another note now lists the rule (the checklist reads `beforeEntry`).
  - `blocks.before-after` (1280, 390): Insights › Psychology shows "Before / after this rule" with the rule picked; each window shows a `windowLines` sentence (the walk member's sample is small, so assert "too few trades to read as a rate").
  - `blocks.prep-pack` (1280, 820, 390): New note → Daily prep makes a note holding the four prep blocks, each frozen or naming its gap; "Capture again" on the wire block moves its "Captured" line.
  - `blocks.review-pack` (1280, 390): log an open position with the Log Trade checklist on (one item of two ticked), close it (`POST /api/j2/positions/{id}/close`); New note → Post-trade review; pick the trade; assert the card, the tags line and "Not ticked before entry: …".
  - `blocks.restore-stamp` (1280): a note made from a member style at v1; the style edited to v2 (a block added) through `PUT /api/j2/journal-styles/{id}`; the banner's Review update → Apply lands v2; History → restore the version from before the update; the banner offers "Update layout to v2?" again (M-7, walked).
  - `blocks.coverage` lists every part-a and part-b block feature.

- [ ] **Step 1: The walk rows**

Write each row above in full in `blocks()`, in that order, in the idiom of part a's `blocks.integrity-tick-leave` (seed through `M`, open with `C.goto(..., wait=".ProseMirror")`, find controls by role and name, assert, `C.step(...)` with the evidence fields). Extend `want` in `blocks.coverage` with the five new feature names. Extend `tests/test_notebook_fin_walk_styles_step.py` with:

```python
def test_the_blocks_step_names_every_part_b_row():
    src = FEATURES.read_text(encoding="utf-8")
    for row in ("blocks.my-rules", "blocks.before-after", "blocks.prep-pack", "blocks.review-pack", "blocks.restore-stamp"):
        assert row in src, row
```

and run:

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_notebook_fin_walk_styles_step.py -q > "$TEMP/p2b-t13-rails.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

- [ ] **Step 2: Door rows**

Read `tools/notebook_door_audit.py` for the step verbs it understands, and `InsightsHub.jsx` for the Insights tab's and section buttons' accessible names. Append, as text, the rows the audit can drive (with the real names):

```json
  {
    "feature": "Before / after this rule (P2b)",
    "audit_row": 61,
    "path": "/journal",
    "steps": [{"click": "tab|Insights"}, {"click": "button|Psychology"}],
    "target": {"role": "combobox", "name": "Rule"},
    "viewports": ["1280", "390"],
    "flag": "NOTEBOOK_JOURNAL_STYLES_ENABLED",
    "note": "The card's rule picker; the card mounts under My rules in Psychology."
  },
  {
    "feature": "New Daily prep note (P2b)",
    "audit_row": 63,
    "path": "/journal/notebook",
    "steps": [{"click": "button|More ways to start a note"}, {"click": "menuitem|From a style"}],
    "target": {"role": "button", "name": "New Daily prep"},
    "viewports": ["1280", "390"],
    "flag": "NOTEBOOK_JOURNAL_STYLES_ENABLED",
    "note": "The P1 kind picker's Daily prep button; the note it makes holds the prep pack."
  }
```

Row 62, "Mark a rule before entry", is inside a note's My rules block, which the audit cannot open (its only seed is `find_similar`); it is measured by `blocks.my-rules` and recorded in the PR body as walk-measured.

- [ ] **Step 3: Pure rails**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_notebook_door_audit.py -q > "$TEMP/p2b-t13-audit.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/notebook_door_audit.py --self-check > "$TEMP/p2b-t13-selfcheck.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

- [ ] **Step 4: Build and bytes**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npm run build > "$TEMP/p2b-build.log" 2>&1; code=$?; echo "BUILD EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/notebook_perf_budgets.py --dist app/dist --json docs/notebook/perf-runs/p2b/bytes-after.json > "$TEMP/p2b-bytes.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: exit 0; the delta over part a's `docs/notebook/perf-runs/p2a/bytes-after.json` is ≤ 1,536 B (registry rows ≤ 1,024, slash items ≤ 512), read from the chunk list; the total stays under 2,260,793 B.

- [ ] **Step 5: Typing with one of every block (PowerShell tool, quiet box, memory printed first)**

`--with-blocks` exists since part a; make it seed all ten kinds (its `--dry-run` case asserts ten). Then:

```powershell
python tools/notebook_perf_harness.py --boot --busy --with-blocks --sizes <part a V2's sizes> --opens 20 --chars 60 --json docs/notebook/perf-runs/p2b/blocks.json --md docs/notebook/perf-runs/p2b/blocks.md
```

Commit the raw JSON and log BEFORE comparing (R-RAW). Compare `typing_busy_per_char` p95 at each size with the baseline of record (part a's V2) and with part a's `blocks.json`. A regression beyond the recorded run-to-run spread is a defect to fix, never a moved line.

- [ ] **Step 6: Sandbox walk c2 and door audit (PowerShell for the data dir)**

```powershell
python tools/notebook_fin_walk.py --config c2 --data-root 'C:\Users\Patrick\AppData\Local\Temp\nb-p2b-walk' --port 8134 --out 'C:\Users\Patrick\uct-worktrees\notebook-p2\docs\notebook\evidence\fin-walk\<tip>\c2' --tip <tip>
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/notebook_door_audit.py --base http://127.0.0.1:8134 --doors tools/notebook_door_audit_doors.json --out docs/notebook/evidence
```

Expected: 0 FAIL (every part-a row still PASS); rows 61 and 63 EASY or OK at 1280 and 390; none HIDDEN. Diff verdicts against part a's committed c2 record.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add tools/notebook_fin_walk_features.py tools/notebook_door_audit_doors.json tools/notebook_perf_harness.py tests/test_notebook_fin_walk_styles_step.py docs/notebook/evidence docs/notebook/perf-runs/p2b
git commit -F - -- tools/notebook_fin_walk_features.py tools/notebook_door_audit_doors.json tools/notebook_perf_harness.py tests/test_notebook_fin_walk_styles_step.py docs/notebook/evidence docs/notebook/perf-runs/p2b <<'MSG'
test(notebook): P2b walk rows (rules, before/after, packs, restore stamp), door rows, bytes and typing with every block

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 14: Exit bar — gate, Python rails on the landing tree, PR

- [ ] **Step 1: A gate worktree with a `notebook-*` branch name**

```bash
SHA=$(git -C /c/Users/Patrick/uct-worktrees/notebook-p2 rev-parse HEAD)
git -C /c/Users/Patrick/uct-worktrees/notebook-p2 worktree add -b notebook-p2b-gate /c/Users/Patrick/uct-worktrees/notebook-p2b-gate "$SHA"
printf 'session: <this session id>\ncreated: <YYYY-MM-DD>\n' > /c/Users/Patrick/uct-worktrees/notebook-p2b-gate/.uct-session-owner
```

```powershell
New-Item -ItemType Junction -Path C:\Users\Patrick\uct-worktrees\notebook-p2b-gate\app\node_modules -Target C:\Users\Patrick\uct-worktrees\notebook-k\app\node_modules
Get-Item C:\Users\Patrick\uct-worktrees\notebook-p2b-gate\app\node_modules -Force | Select-Object LinkType, Target
(Get-Counter '\Memory\Available MBytes').CounterSamples.CookedValue
```

Expected: `LinkType Junction`; ≥ 8,000 MB available and no other gate running, otherwise wait.

- [ ] **Step 2: Gate**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2b-gate
python scripts/gate_shards.py --shards 6 --out docs/notebook/gate-runs/p2b-landing > "$TEMP/p2b-gate.log" 2>&1; code=$?; echo "GATE EXIT: $code"; exit $code
```

Read the manifest: totals, file-count reconciliation, `GATE EXIT`. An `INVALID-*.md` is the environment. Classify any NEW failure by running it alone on the branch and on the base.

- [ ] **Step 3: Python rails on the landing tree**

Merge `origin/master` first if it moved (one merge, no rebase). Then:

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
PYTHONIOENCODING=utf-8 python -m pytest tests/test_rule_versions.py tests/test_rule_before_after.py tests/test_restore_style_stamp.py tests/test_trader_blocks_prep.py tests/test_trader_blocks_review.py tests/test_trader_blocks.py tests/test_trader_blocks_pre_entry.py tests/test_trader_blocks_no_note_door.py tests/test_regime_at_write.py tests/test_notebook_fin_walk_styles_step.py tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_create.py tests/test_journal_styles_update.py tests/test_notebook_journal_styles_router.py tests/test_notebook_contract_fixtures.py tests/test_journal_two_notes_versions_router.py tests/test_notes_cas_is_atomic.py tests/test_notes_answer_is_the_committed_row.py tests/test_notebook_door_audit.py tests/test_notebook_flags.py tests/test_address_space.py tests/test_account_deletion_manifest.py tests/test_gate_shards.py tests/test_user_definitions_auth.py tests/test_paywall_gate_free_tier.py -q > "$TEMP/p2b-py-landing.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

(Add every existing rules test file `ls tests | grep -i rule` names.) Then `python tools/gate_carry_over.py --help` and run the carry-over check as it prints, against the gated tree and the landing tree. UNKNOWN is never a pass; a C1-C3 failure means re-gate.

- [ ] **Step 4: PR body and report**

Open the PR from `notebook-p2b-rules` (one master merge at a time; `web` SUCCESS before any other push). The body says: what shipped, dark; R-P2b-1 to R-P2b-7 with their costs; the new table and its purge, manifest and address-space rows; M-7 closed (with `blocks.restore-stamp`); the bytes and typing numbers; the walk and door-audit numbers (and which rows are walk-measured); that arming is Task 15 and has not happened. It ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
```

After merge, verify the deploy by its artifact: the deploy record's commit and `SUCCESS`, uptime ≥ 730 s, `python tools/hub_nav_smoke.py --auth`, `git merge-base --is-ancestor <merge sha> origin/production`. H15: a failing smoke means roll back first; INCONCLUSIVE is not FAILED.

- [ ] **Step 5: Clean up the gate worktree** (its `.uct-session-owner` names this session)

```powershell
cmd /c rmdir C:\Users\Patrick\uct-worktrees\notebook-p2b-gate\app\node_modules
```

```bash
git -C /c/Users/Patrick/uct-worktrees/notebook-p2 worktree remove /c/Users/Patrick/uct-worktrees/notebook-p2b-gate
```

---

### Task 15: Pre-arming checks, NVDA, and arming (owner's box)

R-P2b-7. Runs once, after part b's PR is merged and its deploy is verified.

**Files:**
- Modify: `docs/notebook/screen-reader-pass.md` (new rows), `tools/notebook_nvda_pass.py` only if a new row needs a driver step the tool lacks
- Modify: `docs/feature_flags.json` (the arming record)
- Create: `docs/notebook/evidence/screen-reader/nvda-<stamp>.json` (+ the speech lines)

- [ ] **Step 1: Write the NVDA rows**

Add rows to `docs/notebook/screen-reader-pass.md`, in the format V10 recorded, each with the phrases NVDA must speak: the Styles manager and style editor (P1's owed pass: "Journal styles dialog", a block row's "Move up" button, "Timeframe for Chart of the note’s ticker"), and one row per block: "Pre-entry checklist grouping", a checklist item "check box not checked", "Stamp prices as I write switch", "Entry edit", "Setup grade combo box", "Capture now button", "Rule … Edit button", "Trade to review combo box". Run `python tools/notebook_nvda_pass.py --self-check` (exit 0).

- [ ] **Step 2: Start NVDA muted (PowerShell tool)**

Use a config whose synth is `silence`, at log level 12, to a log file under the scratchpad:

```powershell
& 'C:/Program Files/NVDA/nvda.exe' -m --log-level=12 --log-file="$env:TEMP\nvda-p2.log" --config-path="$env:TEMP\nvda-silent-config"
```

(`$env:TEMP\nvda-silent-config` holds an `nvda.ini` whose `[speech] synth = silence`; create it before the run and check the file content.) Confirm silence before any row: nothing is spoken aloud on the box, and the log is receiving `Speaking [` lines.

- [ ] **Step 3: Drive the rows**

Per V9: against the sandbox (`--base http://127.0.0.1:<port>`, the switch on in that boot) before arming, or against production right after Step 5's flip. `--only <new row numbers>`, `--out docs/notebook/evidence/screen-reader/nvda-<stamp>.json`, `--nvda-log "$env:TEMP\nvda-p2.log"`. The tool's foreground guard is its whole safety: never bypass an INCONCLUSIVE foreground stop.

- [ ] **Step 4: Quit NVDA and prove it is gone (always, in teardown, even after a failure)**

```powershell
& 'C:/Program Files/NVDA/nvda.exe' -q
Start-Sleep -Seconds 3
Get-Process nvda -ErrorAction SilentlyContinue
```

Expected: no process. If one remains, run the quit again; never leave NVDA running or speaking on the owner's desktop. Record the empty `Get-Process` in the evidence notes.

- [ ] **Step 5: Arm**

On the owner's standing go (10/03): set `NOTEBOOK_JOURNAL_STYLES_ENABLED=1` on `web`; watch for a new boot (a startup line stamped after the set; if none within ~3 minutes, `railway redeploy --service web --yes`); confirm the RUNNING process has it (in-process read over `railway ssh` with `/opt/venv/bin/python`, never `--kv` alone); `python tools/hub_nav_smoke.py --auth`. If NVDA ran post-flip (V9) and any row FAILed: turn the flag off first (`railway variable delete NOTEBOOK_JOURNAL_STYLES_ENABLED --service web`, then `railway redeploy --service web --yes`, and confirm in-process), then report.

- [ ] **Step 6: Record**

In the same docs push: `docs/feature_flags.json` → `NOTEBOOK_JOURNAL_STYLES_ENABLED` `status: "armed"`, `where: "web"`, the flip timestamp in the note; the NVDA evidence (raw first, R-RAW); the memory/checkpoint update the session's rules require.

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add docs/notebook/screen-reader-pass.md docs/notebook/evidence/screen-reader docs/feature_flags.json
git commit -F - -- docs/notebook/screen-reader-pass.md docs/notebook/evidence/screen-reader docs/feature_flags.json <<'MSG'
docs(notebook): P1+P2 T1 armed -- NVDA pass (muted, quit, gone), flag ledger armed with the flip time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

## Self-review (done at write time)

**Spec coverage (part b's share):**
- Item 1, the "before entry" half → Task 3 (`beforeEntry` on the rule record, which part a's checklist reads) and Task 8 (the switch).
- Item 2 → Task 3 (versions, the edit door, "v3 · changed Oct 2" via `versionLine`), Task 4 (the numbers), Tasks 8-9 (the block and the Insights card with sample sizes; under 10 trades says so).
- Item 6 → Tasks 6 and 10 (four small blocks; frozen, R-P2b-6), Task 12 (the Daily prep style includes them).
- Item 7 → Tasks 7 and 11 (one block, R-P2b-5; the plan grade or "needs plan grading"; the tags; the unticked items, R-P2b-4), Task 12 (the Review style).
- Per-block contract → each block body's empty/gap state, `BlockNeedsSwitch` for the setups board and plan grading, 44 px targets, named controls, walk rows in Task 13.
- Integrity rule → the prep/review/rules blocks write the note only through `setParams` (prep snapshot, review `tradeId`); the rule door is a named non-note exception in `blockDoors.test.js`; `test_trader_blocks_no_note_door.py` still guards `trader_blocks.py`; the door census is untouched.
- §6 → lazy chunks (every body, the Insights card), bytes (Task 13), typing with one of every block (Task 13), contract fixtures (Tasks 3, 4, 6, 7, 12), ONE-FACT rails (catalog via part a's rail; `SMALL_SAMPLE` in Task 9), c2 walk steps at 1280/820/390 (Task 13), door rows (Task 13), NVDA at arming (Task 15).
- P1 parked M-7 → Task 5 (and walked in Task 13).
- New table rules → Task 3 (address space, purge, manifest).

**Placeholders:** the look-ups are written as commands with consequences (V1-V10). Three test files are specified by their exact cases rather than full code because they must use mocks of response shapes V4/V7 record (`RuleBeforeAfterCard.test.jsx`, `TradeReviewBlock.test.jsx`, the `PrepLevelsBlock` line) and Task 13's walk rows are specified row by row with what each asserts. `MyRulesBlock.jsx` and `TradeReviewBlock.jsx` are specified by behaviour, controls, names and sentences; their implementer writes them in full against the tests written first.

**Type consistency:** `edit_rule` / `list_versions` / `before_after` (Tasks 3-4) are what the routes and `rulesApi`/`RuleBeforeAfterCard` call; the rule record's `beforeEntry` (Task 3) is what part a's `checklistItems` reads; `Window` keys (Task 4) are what `windowLines` (Task 9) reads; `prep_part`'s shapes (Task 6) are what the prep bodies read; `trade_review`'s shape (Task 7) is what `TradeReviewBlock` reads; `PRE_ENTRY_PREFIX` (part a Task 5) is reused in Task 7; the six block ids are identical across both catalogs, the registry, `BLOCK_COMPONENTS`, `BUILDERS`, the slash items and the built-in styles.

**Review Focus:** each of the five lines names its owning test, written (or specified case by case) in Tasks 4, 5, 6, 7, 9, 10 and 11.
