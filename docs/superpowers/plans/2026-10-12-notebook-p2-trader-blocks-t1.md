# Notebook P2 Tier 1 (part a): Trader Blocks Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members can put live trader blocks into a note, by hand (slash menu, Trading group) or through a journal style: a pre-entry checklist (also offered in Log Trade as a soft check), a frozen market context stamp, price-stamped lines, and a house-formula position sizer. Every block keeps its state in the note's own `widgetEmbed` node and changes only through an editor transaction. Ships dark behind `NOTEBOOK_JOURNAL_STYLES_ENABLED` and is paid.

**Architecture:**
- **A block is a widget kind.** Each block is a `widgetEmbed` node whose `widgetId` is a block id, registered in `app/src/widgets/registry.js` as a capture-only entry with a new `block: true` marker. `WidgetEmbedView` hands any block to a lazy `BlockNodeView`, which owns the empty, error and "needs a switch" states and gives the block body ONE way to change its state: `setParams`, an editor transaction through TipTap's `updateAttributes`.
- **No new write door.** Blocks READ server data through existing endpoints or one new read route (`GET /api/j2/trader-blocks/market-context`). The only new write route (`PUT /api/j2/trader-blocks/positions/{id}/pre-entry`) writes the adherence store, never a note. A new rail fails if any block file sends a non-GET request or imports a note-write helper, and the existing door census still pins the server to SEVEN note-advancing functions.
- **Styles reuse P1 unchanged.** Each block gets a row in BOTH catalogs (`journal_styles.BLOCK_KINDS` and `lib/journalBlocks.js`, railed) and a server builder in `BLOCK_BUILDERS`, exactly the seam P1 left. The built-in Trade plan style moves to version 2 and includes the checklist, the market context stamp and the sizer, so "Update layout to v2" offers them to Trade plan notes already written.
- **Every new surface is a lazy chunk.** The first-open closure gains only the registry rows, the dispatcher line, the slash items and the price-stamp extension stub.

**Tech Stack:** FastAPI + SQLite (`auth.db`, `j2_` tables), React + Vite, TipTap 2 / ProseMirror, vitest + Testing Library, acorn, pytest, Python Playwright walk tools.

**Spec:** `docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md`, §P2 preamble (lines 219-232) and Tier 1 items 1, 3, 4 and 5 (lines 235-258). Also §0, §1, §2, §6, §7 (decisions 1 and 5 taken as recommended) and §8. Part b (`docs/superpowers/plans/2026-10-12-notebook-p2b-rules-packs-t1.md`) carries items 2, 6 and 7, rule versions, the before/after insight, M-7 and the NVDA pass.

**Base:** `origin/master` at Task 0 time. P1 is in master (`ed39eb2038` merge commit, P1 tip `3704241461`). Worktree `C:\Users\Patrick\uct-worktrees\notebook-p2`, branch `notebook-p2-blocks` (a `notebook-*` name, so `hub/rule12Paths.test.js` scopes it correctly).

## Why two plans

Tier 1 is 5-6 agent-days (spec §8) and splits cleanly on one seam: **does the block need a new table?** Part a (this plan) builds the block platform and the four blocks that need no new table, and lands as its own dark PR, so the platform is gated, walked and byte-measured before eight more blocks stand on it. Part b adds the one new table (`j2_journal_rule_versions`), the rule-editing door, the Insights card, the two packs, M-7 and the arming checks. The interface between them is named in Task 7 (`rule.beforeEntry`), Task 3 (`BLOCK_BUILDERS`) and Task 6 (`BLOCK_COMPONENTS`). Arming happens once, after part b.

## Rulings this plan makes (each also in the PR body)

- **R-P2-1, the switch.** No new flag. Every P2 block rides `NOTEBOOK_JOURNAL_STYLES_ENABLED`: the switch gates CREATING a block (slash items, style composition, Log Trade's checklist, the new routes), never RENDERING one (spec P1.7c; `docs/notebook/p1-verify-before-building.md` §c). Why: spec §2 ships P1 and P2 T1 as one release; a per-block flag would add dark states that each need their own "needs X" copy, with no rollback gain, because a rendered block writes nothing on its own. Cost if wrong: after arming, a misbehaving block can only be withdrawn by turning the whole styles switch off (P1 goes dark with it); recovery is a deploy that drops the block's slash item and catalog row.
- **R-P2-2, price stamps are a block card, not an inline chip.** The spec calls `financialFact` inline (§1 table), but the node is `group: 'block'` (`app/src/pages/journal-2-0/lib/financialFactNode.jsx:24`, `group: 'block',`). The stamp is inserted as its own block directly after the line that named the ticker. An inline variant would be a new node type (schema level 5, never-revert), which §1's design rule forbids where avoidable. Cost if wrong: the stamp reads as a card under the line; an inline form later needs a schema level.
- **R-P2-3, which tickers a line "names".** The client detects only explicit cashtags (`$NVDA`) with the ONE resolver's cashtag tier (`app/src/lib/tickerResolver.js:32`, `export function resolveCashtags(text) {`), plus the note's own Ticker field written as a bare word. Its header says why bare words stay on the server: "a browser that guessed bare words would be a second resolver". One stamp per Enter, for the first ticker. Cost if wrong: a line naming `NVDA` with no `$` gets no stamp; the block's own copy tells the member to write `$NVDA`.
- **R-P2-4, block settings stay finite.** Style-level block settings use the existing select grammar (`StyleEditor.jsx:275-278` renders every setting as a `<select>` of `options`), so "which setup" is chosen in the note, not in the style, and "which fields" for the market context is one of three presets (`all`, `regime`, `indexes`). Cost if wrong: a member who wants a style pinned to one setup picks it once per note; a free-text setting type is a later, additive change to `_clean_blocks`.
- **R-P2-5, the house sizing table.** The sizer mirrors the house table `_SIZING_TABLE` in `uct-intelligence/uct_intelligence/api.py:2775` (read at write time): GREEN A+ 25 / A 20 / B 10, YELLOW A+ 15 / A 12 / B 6, ORANGE A+ 8 / A 5 / B 0, RED all 0. It agrees with every cell the spec names (YELLOW A+ 15%, ORANGE A+ 8%, B in ORANGE = skip); the spec's "GREEN A+ 20-25%" is read as the GREEN band from A (20) to A+ (25). Zero means skip. Cost if wrong: an A+ in GREEN is offered 25% where the owner meant 20%; the 2% account-risk cap binds first whenever the stop is wider than 8%.
- **R-P2-6, `builtin:regime_at_write` is a captured fact.** It is written once, by the composer, from the market context block's own snapshot; a member cannot set it, a version restore keeps it, a template never carries it. "Show notes written in RED/ORANGE" is the Board view grouped by it, saved with the existing Save view door (no seeded saved view, which would be a write per member).
- **R-P2-7, Log Trade for an open position.** Ticks made while logging a CLOSED trade go to that trade's adherence record (existing `PUT /api/j2/trades/{id}/adherence`). Ticks made while logging an OPEN position go to the adherence store under `pos:<position id>`, and the closed trade's adherence read falls back to that record. No new table.

## Global Constraints

- Member-facing names (spec §7.1): **"Journal styles"**, **"Kind of note"**, **"outline"**, **"block"**. Block names: "Pre-entry checklist", "Market context", "Price stamps", "Position sizing".
- Every new surface requires a paid plan (owner ruling 2026-10-06). New routes live in `api/routers/notebook_journal_styles.py` and take its `require_paid` (402, `"Journal styles require a paid plan"`) behind its router-level gate (one `404 {"detail": "Not found"}` while off).
- Dark behind `NOTEBOOK_JOURNAL_STYLES_ENABLED` (R-P2-1). No new flag, so `tests/test_notebook_flags.py` `NOTEBOOK_KEYS` and `docs/feature_flags.json` do not change.
- The switch gates CREATING, never RENDERING. A note that holds a block renders it with the switch off, and an older bundle shows "This block needs a newer version of the app. Reload to see it." (`WidgetEmbedView.jsx:140`) and keeps the node.
- **INTEGRITY RULE (spec §P2, non-negotiable).** A block's member state lives in the node's `params` attribute and changes ONLY through `setParams` (an editor transaction). No block file sends a non-GET request except the two named in Task 6's rail. No block owns a PUT/PATCH to a note. Server data is READ-only to a block.
- Schema: **zero schema-level bumps.** Block state rides `params` (`widgetEmbedNode.jsx:118`, `params: jsonAttr('data-params', {}),`), never a new attribute: an older bundle drops an attribute it does not declare (`docs/notebook/p1-verify-before-building.md` §a). A task that finds it needs a node type or attribute STOPS and reports.
- ONE FACT IN TWO FILES gets a rail that PARSES the other file: the block catalog (`journal_styles.BLOCK_KINDS` ⇄ `lib/journalBlocks.js`, extended in Task 3 to the `search` line) and the house sizing table (Task 11, pinned to the cited engine lines).
- New preference keys go into `api/routers/auth.py::_PREFERENCE_KEYS` AND `app/src/hooks/usePreferences.additionsOnly.test.js` `BASELINE_KEYS`, in the same commit, with literal keys (`notebook_log_trade_checklist`, Task 8).
- New Python paths read by vitest rails go into `scripts/gate_shards.py` `GATE_READ_PATHS` (Task 6's rail reads `api/services/journal_two/trader_blocks.py`).
- No new table in part a, so `api/services/address_space.py`, account purge and the deletion manifest do not change. A task that adds one STOPS: that is part b's.
- No new `document`/`window` key listener (`pages/command/keyListenerCensus.test.js`). Blocks use `onKeyDown`; the price-stamp extension uses a TipTap keyboard shortcut (editor keymaps are out of the census's scope, its header says).
- Note writes: every client call that advances a note's `updatedAt` lands it with `settleNoteWrite` (`lib/offline/doorEnumeration.test.js`, `MODE = 'fail'`). P2a adds none.
- Bytes: the Notebook first-open closure (`python tools/notebook_perf_budgets.py --dist app/dist`) stays under `max` 2,260,793 B (`docs/notebook/perf-budgets.json:11`). Part a's allowance is **+3,072 B** in total, split as Task 6 ≤ 1,536 B (registry rows + dispatcher), Task 10 ≤ 512 B (extension stub), Task 12 ≤ 1,024 B (slash items). A task over its allowance moves code into a lazy chunk before it lands; it never edits `perf-budgets.json`.
- Typing: no regression against the 2026-10-10 busy-time baseline (p95 4.94 / 7.07 / 9.37 ms), same instrument (`tools/notebook_perf_harness.py --busy`), same sizes, plus a note holding one of every block (Task 13).
- Touch targets ≥ `var(--tap-min)` at ≤1024 px (`styles/tapFloor.test.js`); every control has an accessible name; breakpoints only 640 and 1024; icons are `UIcon` names; no emoji.
- Every new `data-tour` literal appears once in its file (`tourAnchors.test.js`). P2a adds none (tours are P5).
- Tests: `cd app && npx vitest run <explicit files>`. Backend pytest by NAMED FILES only. A run without a totals line is not a run. Never verify through a pipe or a trailing `echo`: `cmd > log 2>&1; code=$?; echo "EXIT: $code"; exit $code`. `-t` is a regex: a filter that matches nothing exits 0.
- Run the suite in its own tool call and read the totals before committing.
- Commits: `git commit -F - -- <paths> <<'MSG'` (pathspec on the commit). Every message ends with exactly:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ`
- Write files with the line endings git stores (new files LF); run `python tools/check_repo_hygiene.py` before each commit.
- Never touch `C:\data`. Sandboxes go through `scripts/hub_sandbox_boot.py`; data dirs are passed from PowerShell or single-quoted. At most 3 agents; print `(Get-Counter '\Memory\Available MBytes').CounterSamples.CookedValue` before each launch and stay at 3 under ~4 GB.
- Mutation proofs restore by captured bytes (sha checked against `git cat-file blob HEAD:<path>`), never `git checkout --`.

## Review Focus

Five inputs the spec implies but no feature test exercises on its own. Each names the test that pins it.

1. **A member ticks a checklist item and leaves the note within 1.5 s** (the P0.0 fork shape). The tick must land through the note's one save path and leave no "(conflicted copy)". Pinned in Task 6, `blockParams.test.jsx` "a tick is ONE transaction through updateAttributes, no fetch", and walked in Task 13, `blocks.integrity-tick-leave`.
2. **A price stamp arrives after the member has deleted or moved the line** (the fetch is async). It must land after the line wherever the line now is, or not at all if the line is gone, and never inside another word. Pinned in Task 10, `priceStamps.test.js` "a deleted line takes no stamp" and "a moved line takes its stamp where it now is".
3. **A note holding a block is opened by a member whose account has no setup rules, no rules and no account size.** Each block must say what to do, never render an empty box or throw. Pinned in Task 7 `PreEntryChecklistBlock.test.jsx` "no setups yet" and Task 11 `PositionSizingBlock.test.jsx` "no account size".
4. **A version restore of a note that carries `builtin:regime_at_write`.** The restore replaces properties (`notes.py:3598`, `"propertiesReplace": version["propertiesJson"] or {},`) through a validator that refuses non-member-set built-ins (`note_properties.py:455`). Without Task 4 every such restore answers 400. Pinned in Task 4, `test_a_version_restore_keeps_the_captured_regime`.
5. **The sizer is fed a stop on the wrong side, an equal entry and stop, or a grade the regime skips.** It must say why and size nothing, never a negative share count. Pinned in Task 11, `houseSizing.test.js` "wrong-side, equal and skip cases".

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `docs/notebook/p2-verify-before-building.md` (new) | every citation this plan leans on, re-read; the open verification items, resolved | 1 |
| `tools/notebook_fin_walk.py`, `tools/notebook_fin_walk_features.py` | P1 walk-tool minors (R24); then the P2a walk steps | 2, 13 |
| `J/components/notebook/NewNoteMenu.listCaret.css.test.js` | P1 test hardening (R28 N1/N2), only if the list caret is on the base | 2 |
| `api/services/journal_two/journal_styles.py` | catalog rows, builders wired, composer captures the regime; Trade plan v2 | 3, 4, 12 |
| `api/services/journal_two/trader_blocks.py` (new) | block builders, the market context snapshot, the pre-entry record | 3, 5 |
| `J/lib/journalBlocks.js` | client catalog rows (labels, settings, `search`, option labels) | 3 |
| `api/routers/notebook_journal_styles.py` | `GET /trader-blocks/market-context`, `PUT /trader-blocks/positions/{id}/pre-entry` | 3, 5 |
| `tools/notebook_contract_fixtures.py`, `J/__fixtures__/contract/*` | fixtures for both routes | 3, 5 |
| `api/services/journal_two/note_properties.py`, `notes.py` | `builtin:regime_at_write` and the captured-property modes | 4 |
| `api/services/journal_two/adherence_store.py`, `api/routers/journal_two.py` | the `pos:` fallback on a closed trade's adherence read | 5 |
| `src/widgets/registry.js`, `registry.test.js` | four block manifests (`captureOnly`, `block: true`) | 6 |
| `B/WidgetEmbedView.jsx` | hand a block to the lazy `BlockNodeView` | 6 |
| `B/blocks/*` (new, lazy) | `BlockNodeView`, `useBlockParams`, states, the four block bodies | 6, 7, 9, 10, 11 |
| `J/lib/blocks/*` (new) | `checklistItems.js`, `priceStamps.js`, `houseSizing.js`, the door rail | 6, 7, 10, 11 |
| `B/styles/StyleEditor.jsx` | option labels from the catalog (additive) | 3 |
| `J/components/AddPositionModal.jsx`, `AddTradeModal.jsx`, `J/LogTradeButton.jsx` | the checklist in Log Trade, soft warning | 8 |
| `api/routers/auth.py`, `src/hooks/usePreferences.additionsOnly.test.js` | `notebook_log_trade_checklist` | 8 |
| `J/lib/tiptap.js` | register the price-stamp extension | 10 |
| `B/SlashMenu.jsx` | four block items in the Trading group | 12 |
| `scripts/gate_shards.py` | `trader_blocks.py` in `GATE_READ_PATHS` | 6 |
| `tools/notebook_perf_harness.py` | `--with-blocks` | 13 |
| `tools/notebook_door_audit_doors.json` | rows 57-60 (and row 56 measured, if the caret is on the base) | 13 |

`J` = `app/src/pages/journal-2-0`, `B` = `J/components/notebook`.

## Lanes and waves

| Wave | Lane | Tasks | Agent |
|---|---|---|---|
| W0 | F | 0, 1 | one (controller may do it) |
| W1 | S (server) | 3 → 4 → 5 | opus |
| W1 | C (client platform) | 6 | opus |
| W1 | W (walk debt) | 2 | sonnet |
| W2 | A | 7 → 8 | opus |
| W2 | B | 9 → 10 | opus |
| W2 | D | 11 | sonnet |
| W3 | integrator | 12 → 13 → 14 | controller + one agent |

W2 starts only after lanes S and C are merged into `notebook-p2-blocks` and re-tested in the integrator's session.

Files shared by more than one task, and how each pair is ordered:

| File | Tasks | Resolution |
|---|---|---|
| `journal_styles.py` | 3, 4, 12 | 3 → 4 in lane S; 12 in W3 after S merged |
| `notebook_journal_styles.py` | 3, 5 | same lane, in order |
| `tools/notebook_contract_fixtures.py` + fixtures dir | 3, 5 | same lane, in order |
| `trader_blocks.py` | 3, 5, 9 (reads only) | created in 3; 5 appends; 9 imports nothing server-side |
| `lib/journalBlocks.js` | 3, 7, 9, 11 (read only) | written in 3 only |
| `registry.js` | 6 only | all four manifests in one task |
| `blocks/BlockNodeView.jsx` | 6 only | the map points at four stub bodies Task 6 creates; 7, 9, 10, 11 REPLACE their own stub file, never the map |
| `notebook_fin_walk_features.py` | 2, 13 | W1 then W3, same file, sequential |
| `AddPositionModal.jsx`, `AddTradeModal.jsx` | 8 only | |
| `SlashMenu.jsx` | 12 only | |
| `tiptap.js` | 10 only | |

---

### Task 0: Worktree

**Files:** none (environment)

- [ ] **Step 1: Create the worktree from a fresh master and mark ownership**

```bash
git -C /c/Users/Patrick/uct-worktrees/notebook-p1 fetch origin
git -C /c/Users/Patrick/uct-worktrees/notebook-p1 worktree add -b notebook-p2-blocks /c/Users/Patrick/uct-worktrees/notebook-p2 origin/master
printf 'session: <this session id>\ncreated: <YYYY-MM-DD>\n' > /c/Users/Patrick/uct-worktrees/notebook-p2/.uct-session-owner
git -C /c/Users/Patrick/uct-worktrees/notebook-p2 status --short --branch
```

Expected: `## notebook-p2-blocks...origin/master` and a clean tree.

- [ ] **Step 2: Junction an installed node_modules (PowerShell tool)**

```powershell
New-Item -ItemType Junction -Path C:\Users\Patrick\uct-worktrees\notebook-p2\app\node_modules -Target C:\Users\Patrick\uct-worktrees\notebook-k\app\node_modules
Get-Item C:\Users\Patrick\uct-worktrees\notebook-p2\app\node_modules -Force | Select-Object LinkType, Target
```

Expected: `LinkType Junction`. At removal use `cmd /c rmdir` only, from the PowerShell tool.

- [ ] **Step 3: Baseline the files this plan touches**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/widgets/registry.test.js src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/hooks/usePreferences.additionsOnly.test.js src/pages/command/keyListenerCensus.test.js src/components/screener/reachable.test.js > "$TEMP/p2a-baseline.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_update.py tests/test_notebook_journal_styles_router.py tests/test_notebook_contract_fixtures.py tests/test_note_kind_property.py tests/test_gate_shards.py -q > "$TEMP/p2a-baseline-py.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Read both totals lines. Record any pre-existing red, by name, in the PR body. Pre-existing reds are not this plan's to fix.

---

### Task 1: Verify before building, written down

No product code. This task produces `docs/notebook/p2-verify-before-building.md`, which every later task cites. **Every quote is re-read at write time**: run the grep, read the matched line's CONTENT, and confirm it says what the row claims. A line that moved is updated. A claim the content no longer supports is STRUCK and the task stops and reports.

**Files:**
- Create: `docs/notebook/p2-verify-before-building.md`

**Interfaces:**
- Produces: the findings document, sections `§cite` (the quotes), `§V1`-`§V13` (the open items, each answered with a file:line or a measurement). Tasks 3-13 cite it.

- [ ] **Step 1: Re-verify every citation this plan leans on**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
grep -n "ONE FACT IN TWO FILES with app/src/pages/journal-2-0/lib/journalBlocks.js" api/services/journal_two/journal_styles.py
grep -n "Every id in BLOCK_KINDS has a builder (railed); P2 adds both together." api/services/journal_two/journal_styles.py
grep -n 'BLOCK_BUILDERS: dict\[str, Callable' api/services/journal_two/journal_styles.py
grep -n "P2 adds rows here AND in journal_styles.BLOCK_KINDS (with a builder)." app/src/pages/journal-2-0/lib/journalBlocks.js
grep -n "const EMBED_COMPONENTS = {" app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx
grep -n "export const UNKNOWN_BLOCK_SENTENCE = 'This block needs a newer version of the app. Reload to see it.'" app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx
grep -n "const shareView = !!editor?.storage?.uctJournalWidgets?.shareView" app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx
grep -n "const needsArchive = decision.kind === 'live'" app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx
grep -n "export default function WidgetEmbedView(" app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx
grep -n "params: jsonAttr('data-params', {})," app/src/pages/journal-2-0/lib/widgetEmbedNode.jsx
grep -n "if (manifest.captureOnly === true) {" app/src/widgets/registry.js
grep -n "export function paramsPlainText(widgetId, params) {" app/src/widgets/registry.js
grep -n "searchText: paramsPlainText(widgetId, params)," app/src/pages/journal-2-0/lib/widgetEmbedCore.js
grep -n "  { id: 'trading', label: 'Trading' }," app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx
grep -n "const TRADING_BLOCKS = new Set(" app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx
grep -n "const res = await fetch(\`/api/j2/notes/\${noteId}/facts\`, {" app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx
grep -n "  group: 'block'," app/src/pages/journal-2-0/lib/financialFactNode.jsx
grep -n "export function resolveCashtags(text) {" app/src/lib/tickerResolver.js
grep -n "BUILTIN_USER_SET_IDS = frozenset" api/services/journal_two/note_properties.py
grep -n 'raise PropertyValidationError(f"{property_id} is not a settable property")' api/services/journal_two/note_properties.py
grep -n "properties_json = set_note_properties(user_id, new_id, properties, conn, replace=True)" api/services/journal_two/notes.py
grep -n '"propertiesReplace": version\["propertiesJson"\] or {},' api/services/journal_two/notes.py
grep -n "new_properties_json = set_note_properties(user_id, note_id, raw, conn, replace=replace)" api/services/journal_two/notes.py
grep -n "def upsert_adherence(" api/services/journal_two/adherence_store.py
grep -n 'return adherence_store.get_adherence(user\["id"\], detail\["tradeRef"\])' api/routers/journal_two.py
grep -n '"positionId": row\["position_id"\],' api/services/journal_two/trades.py
grep -n "^cache = TTLCache(max_size=CACHE_MAX_SIZE)" api/routers/live_prices.py
grep -n 'return f"live_px1_{tk}"' api/routers/live_prices.py
grep -n '"NOTEBOOK_JOURNAL_STYLES_ENABLED": False,' api/routers/auth.py
grep -n "^_PREFERENCE_KEYS = {" api/routers/auth.py
grep -n "^const BASELINE_KEYS = {" app/src/hooks/usePreferences.additionsOnly.test.js
grep -n "^GATE_READ_PATHS = (" scripts/gate_shards.py
grep -n "it('① the SQL names exactly SEVEN functions that advance a note'" app/src/pages/journal-2-0/lib/offline/doorEnumeration.test.js
grep -n '"max": 2260793,' docs/notebook/perf-budgets.json
grep -n "^def paragraphs_doc(n: int, tag: str)" tools/notebook_perf_harness.py
grep -n "^def _seed(req, base: str, sizes: list\[int\], run: str)" tools/notebook_perf_harness.py
grep -n "editor keymaps (TipTap/ProseMirror/CodeMirror, scoped to the editor)" app/src/pages/command/keyListenerCensus.test.js
grep -n '("GREEN",  "A+"): 0.25,' /c/Users/Patrick/uct-intelligence/uct_intelligence/api.py
grep -n '("ORANGE", "B"):  0.00,' /c/Users/Patrick/uct-intelligence/uct_intelligence/api.py
git -C /c/Users/Patrick/uct-intelligence log -1 --format='%H %cs'
```

Each grep must print exactly one line. An empty result is a failed check, never a pass. Record each `file:line` as printed.

- [ ] **Step 2: Answer the open verification items**

Each item below names what to read, and what the answer changes. Write the answer, with the line it rests on, into §V1-§V13.

- **V1 — Is the P1 list caret on the base?** `git merge-base --is-ancestor 4c0dcccc69 HEAD; echo $?` and `git ls-remote origin notebook-p1-list-caret`. At plan time (2026-10-12) `notebook-p1-list-caret` existed only locally (no remote ref) and was NOT an ancestor of `origin/master`. If it is still absent: Task 2's R28 steps and Task 13's row-56 measurement are **recorded as owed with the caret**, and nothing in this plan merges an unpushed branch from another session. If it is present: both run.
- **V2 — The typing baseline of record.** The spec names p95 4.94 / 7.07 / 9.37 ms (2026-10-10). Search `docs/notebook/perf-runs/*/` for the run whose `typing_busy_per_char` p95 rows read those three values at the same three sizes (`grep -rln '"measure": "typing_busy_per_char"' docs/notebook/perf-runs`, then read the p95 rows). At plan time `ty-l15-quiet/q1.json` carried 4.949 and 9.377 and `ty5/ab/A3.json` carried 7.073, so no one file was confirmed. Write down the file and its sizes and `--chars`; Task 13 runs the same flags. If no single run carries all three, Task 13 compares against the latest quiet-box record in `docs/notebook/perf-budgets.md` (at plan time `perf-runs/ty9-quiet-marker/q1.*`: 6.85 / 6.77 / 9.73 ms at 1 / 1,000 / 2,000 ¶) and says so in the PR body.
- **V3 — Which first-open chunk holds `registry.js`.** `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist --json "$TEMP/p2a-bytes-base.json"` and read which chunk's module list contains `widgets/registry.js` and `WidgetEmbedView.jsx`. This is the base number for every allowance in Global Constraints.
- **V4 — The entry-context field readers.** `grep -n "^def _regime_fields\|^def _breadth_field" api/services/journal_two/entry_context.py` and read both bodies: the return shape (`(regime_field, exposure_field)` and one field dict `{value, source, asOf, missing, detail}` per the module header) and whether either can reach a vendor. Task 3 calls both with a shared `memo`. If either can reach a vendor on a cold cache, Task 3's builder reads `regime.get_current_regime()` only and labels breadth `missing`.
- **V5 — The index quotes.** Read `api/routers/live_prices.py` around `cache.set(_px_key(tk), val, ttl=_CACHE_TTL)` for the value's keys (`price`, `change_pct`, `observed_at` at plan time) and whether `^VIX` (or the spelling the app uses for VIX) ever enters that cache. Task 3 reads the cache only; a symbol never cached is labelled `missing` with `detail: "not quoted"`.
- **V6 — `get_trade_detail`'s keys.** Confirm `positionId` and `tradeRef` are both on the dict the adherence routes read (`trades.py` near `"positionId": row["position_id"],`). Task 5 uses both.
- **V7 — How the Properties section shows a built-in a member cannot set.** Read `B/PropertiesSection.jsx` for how `source !== 'user_set'` built-ins (e.g. `builtin:ticker`, `financial_derived`) render, and whether "Add property" lists them. Task 4 gives the new built-in `source: "captured"`; if the section treats any non-`user_set` source as read-only and never offers it, nothing more is needed; otherwise Task 4 adds `captured` to that branch.
- **V8 — Grouping the Board by a built-in select.** Read `NoteBoardView.jsx` and `NotebookTab.jsx` for which properties the board offers as `groupBy`, and for a URL form that opens the board grouped by a property id. Task 9's "Show notes written in this regime" link uses that form; if none exists, the link opens the Board and the block's copy names the "Group by" choice to make.
- **V9 — What a price fact looks like.** Read `B/FinancialFactView.jsx` for how a `factType: 'price'` fact renders (value, ticker, time). Record it; the walk step in Task 13 asserts that text.
- **V10 — The TipTap Enter order.** Read `node_modules/@tiptap/core/dist/index.js` for how `addKeyboardShortcuts` handlers of several extensions are combined (priority order, and whether a handler returning `false` lets the next one and the default Enter run). Task 10's test proves the outcome in a real editor; this records why.
- **V11 — What the Log Trade dialogs return.** Read `J/LogTradeButton.jsx` for what `onSave` resolves with for each dialog (`jsonPost` answers the created row) and the created row's `id` key. Task 8 writes adherence with it.
- **V12 — `notes.create_note`'s keyword list.** `grep -n "^def create_note(" -A 12 api/services/journal_two/notes.py`. Task 4 adds `captured_properties` beside `properties` and `style_stamp`.
- **V13 — The accounts list and settings routes.** Read `api/routers/journal_two.py` for `GET /api/j2/accounts` (a list, or `{"accounts": [...]}`) and `GET`/`PUT /api/j2/accounts/{id}/settings` (the body `useJ2Settings`' `save` sends: the whole settings object). Task 13's integrity row seeds `setups`/`setupRules` through them.

- [ ] **Step 3: Write the finding**

Create `docs/notebook/p2-verify-before-building.md` with a title, the measured `git rev-parse HEAD`, a `§cite` table (claim | `file:line` | the line, quoted) holding every row from Step 1, then `§V1`-`§V13`, each with its answer and the line it rests on. A V-item whose answer changes a later task names that task and the change.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add docs/notebook/p2-verify-before-building.md
git commit -F - -- docs/notebook/p2-verify-before-building.md <<'MSG'
docs(notebook): P2a verify-before-building (citations re-read, thirteen open items answered)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 2: P1 walk-tool minors and test hardening (ledger R24, R28)

Tool and test changes only. Ledger R24 parked M2-M6 as walk-tool follow-ups because "a tool change is only proven by a re-walk"; Task 13's walk is that re-walk. R28 parked N1 and N2 because "any app/src change voids the gate in flight".

**Files:**
- Modify: `tools/notebook_fin_walk.py` (the comment at `:76`)
- Modify: `tools/notebook_fin_walk_features.py` (`styles()`, `:1970-2067`; `d_new_note_home`'s `styles_on`, `:1420`)
- Modify (only if V1 found the caret on the base): `app/src/pages/journal-2-0/components/notebook/NewNoteMenu.listCaret.css.test.js`
- Test: `tests/test_notebook_fin_walk_styles_step.py` (new)

**Interfaces:**
- Produces: `styles.update-layout` now waits for the banner to hide and checks the added block; `styles.unknown-block` types and waits for the save before reading. Task 13 re-walks them.

- [ ] **Step 1: Write the failing source rails**

`tests/test_notebook_fin_walk_styles_step.py`:

```python
"""Ledger R24 (P1 Task 15 review M2-M6): the styles walk step must wait, not sleep; the two rows must
check what their labels claim; the switch count must not be typed; styles_on mirrors the product gate.
These read the tool's source, because the only other proof is a two-hour re-walk (Task 13 is that)."""
from __future__ import annotations

import ast
import re
from pathlib import Path

FEATURES = Path("tools/notebook_fin_walk_features.py")
WALK = Path("tools/notebook_fin_walk.py")


def _styles_body() -> str:
    src = FEATURES.read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "styles":
            return ast.get_source_segment(src, node)
    raise AssertionError("no def styles() in the features file")       # non-vacuity


def test_the_styles_step_has_no_blind_sleep():
    body = _styles_body()
    assert "Review update" in body                                       # non-vacuity: the right function
    assert "wait_for_timeout(" not in body


def test_update_layout_reads_the_added_block_and_unknown_block_saves_first():
    body = _styles_body()
    assert re.search(r'widgetId"\)\s*==\s*"chart"', body), "update-layout must check the chart block landed"
    assert "keyboard.type(" in body.split("walkFutureBlock", 1)[1], "unknown-block must edit the note first"
    assert "save_landed" in body, "unknown-block must wait for the save, not a clock"


def test_no_typed_switch_count():
    src = WALK.read_text(encoding="utf-8")
    assert "WAVE_FLAGS = [" in src                                        # non-vacuity
    assert not re.search(r"\b(seventeen|eighteen|nineteen)\s+switches\b", src)


def test_styles_on_mirrors_the_product_gate():
    src = FEATURES.read_text(encoding="utf-8")
    line = next(l for l in src.splitlines() if "styles_on =" in l)
    assert "notebook_journal_styles_enabled" in line
    assert "paid_equiv" not in line
```

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_notebook_fin_walk_styles_step.py -q > "$TEMP/p2a-t2.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: 4 failed.

- [ ] **Step 3: Fix the tool**

In `tools/notebook_fin_walk.py`, replace the comment at `:76` with:

```python
# The switches waves 11-14 and P1/P2 add and production has not armed (count them from the list,
# never from this line). Read against the ledger at run time (`flag_sets`), so a name that is not a
# real flag refuses the run.
```

In `tools/notebook_fin_walk_features.py`, line `:1420`, drop the second condition so the walk asks the product's own question:

```python
            styles_on = bool(meA.get("notebook_journal_styles_enabled"))
```

In `run_c2`, immediately before `def styles():`, add this helper (in `run_c2`'s scope, so Task 13's `blocks()` step uses it too):

```python
    def save_landed(page, note_id, before_updated, ceiling_ms=15000, poll_ms=250):
        """Poll the SERVER until the note's updatedAt moves (the autosave landed), with a ceiling. The
        server has no waiter to offer, so this is a bounded poll that returns the moment the answer
        exists -- never a fixed sleep that guesses how long a save takes."""
        deadline = time.monotonic() + ceiling_ms / 1000
        while time.monotonic() < deadline:
            got = M.get(base + f"/api/j2/notes/{note_id}").json()["note"]
            if got.get("updatedAt") != before_updated:
                return got
            page.wait_for_timeout(poll_ms)              # the poll interval, inside a ceiling
        return None
```

Replace the update-layout block (`:2034-2042`) with:

```python
        if banner:
            pg.get_by_role("button", name="Review update").click()
            pg.get_by_role("button", name="Apply").click()
            pg.get_by_text(re.compile(r"Update layout to v\d+\?")).first.wait_for(state="hidden", timeout=15000)
        got = M.get(base + f"/api/j2/notes/{n['id']}").json()["note"]
        added = any(x.get("type") == "widgetEmbed" and (x.get("attrs") or {}).get("widgetId") == "chart"
                    for x in got.get("bodyJson", {}).get("content", []))
        conflicted = [x for x in C.notes_list(ctx, base) if "(conflicted copy)" in (x.get("title") or "")]
        ok = banner and added and got.get("styleVersion") == (mine or {}).get("version", 0) + 2 and not conflicted
        C.step(pg, inst, "styles.update-layout", "The banner's Review update -> Apply adds the block, stamps the version, forks nothing",
               "PASS" if ok else "FAIL", style_version=got.get("styleVersion"), chart_added=added, conflicted=len(conflicted))
```

Replace the unknown-block block (`:2054-2061`) with:

```python
        fb = M.post(base + "/api/j2/notes", data={"title": "Future block", "bodyJson": future}).json()["note"]
        C.goto(pg, base, f"/journal/notebook?note={fb['id']}", wait=".ProseMirror")
        card = C.vis_loc(pg.get_by_text("This block needs a newer version of the app. Reload to see it."), 10000)
        ed2 = pg.locator(".ProseMirror").first
        ed2.click()
        pg.keyboard.press("Control+Home")
        pg.keyboard.press("End")
        pg.keyboard.type("y", delay=40)               # an edit, so the save writes the body back
        landed = save_landed(pg, fb["id"], fb["updatedAt"])
        kept = bool(landed) and any((x.get("attrs") or {}).get("widgetId") == "walkFutureBlock"
                                    for x in landed["bodyJson"]["content"])
        C.step(pg, inst, "styles.unknown-block", "A block from a newer version shows the card and survives an edit and a save",
               "PASS" if card and kept else "FAIL", card=card, saved=bool(landed), kept=kept)
```

Add `import time` to the file's imports if it is not there (`grep -n "^import time" tools/notebook_fin_walk_features.py`).

- [ ] **Step 4: R28 N1 and N2 (only if V1 found the caret on the base)**

In `NewNoteMenu.listCaret.css.test.js`, inside the CONTROLS `describe`, add (N1: a commented `@media` block must not count, which only `strip` prevents):

```js
  it('a whole @media block inside a comment does not count (this is what `strip` is for)', () => {
    const css = '/* @media (max-width: 640px) { .listCaret { position: static; } } */ .x { color: red; }'
    expect(declsFor(mediaBlocks(css, PHONE), '.listCaret')).toEqual({})
  })
```

and inside the contract `describe` (N2: the base anchor above 640 px, read from the text BEFORE the first `@media`, because `declsFor` merges every rule for a selector):

```js
  it('at >=641px the caret itself is the menu\'s containing block (base .listCaret is relative)', () => {
    const base = strip(MENU_CSS).split('@media')[0]
    expect(declsFor(base, '.listCaret')).toMatchObject({ position: 'relative', display: 'flex' })
  })
```

Mutation check: delete `const src = strip(css)`'s call to `strip` in `mediaBlocks` (use `const src = css`); the N1 case must FAIL. Restore. Delete `position: relative;` from `.listCaret` in `NewNoteMenu.module.css`; the N2 case must FAIL. Restore both by captured bytes and check the sha against `git cat-file blob HEAD:<path>`.

If V1 found the caret absent, skip this step and write in the PR body: "R28 N1/N2 are owed with the list caret (`notebook-p1-list-caret`, not on master)".

- [ ] **Step 5: Run**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_notebook_fin_walk_styles_step.py -q > "$TEMP/p2a-t2.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/components/notebook/NewNoteMenu.listCaret.css.test.js > "$TEMP/p2a-t2-js.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: 4 passed; the vitest file passes (or does not exist, per V1).

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add tools/notebook_fin_walk.py tools/notebook_fin_walk_features.py tests/test_notebook_fin_walk_styles_step.py
git commit -F - -- tools/notebook_fin_walk.py tools/notebook_fin_walk_features.py tests/test_notebook_fin_walk_styles_step.py <<'MSG'
test(notebook): P1 walk minors (R24) -- waiters not sleeps, the two styles rows check what they claim, styles_on mirrors the gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

(If Step 4 ran, add `app/src/pages/journal-2-0/components/notebook/NewNoteMenu.listCaret.css.test.js` to both the `git add` and the commit pathspec.)

---

### Task 3: Server catalog rows, builders and the market context read

**Files:**
- Create: `api/services/journal_two/trader_blocks.py`
- Modify: `api/services/journal_two/journal_styles.py` (`BLOCK_KINDS` `:51-53`, `BLOCK_BUILDERS` `:646-647`, `compose`'s `ctx`)
- Modify: `app/src/pages/journal-2-0/lib/journalBlocks.js`
- Modify: `app/src/pages/journal-2-0/components/notebook/styles/StyleEditor.jsx` (option labels, `:278`)
- Modify: `api/routers/notebook_journal_styles.py` (one GET route)
- Modify: `tools/notebook_contract_fixtures.py` (`journal_styles` builder, `:1648`)
- Test: `tests/test_trader_blocks.py` (new), `tests/test_journal_styles_store.py` (`:41-47`, the shape)

**Interfaces:**
- Produces (server):
  - `BLOCK_KINDS` rows `preEntryChecklist`, `marketContext`, `priceStamps`, `positionSizing`, each `{"id", "search", "settings": ({"key", "options", "default"},...)}`. `chart` has no `search`.
  - `trader_blocks.BLOCK_IDS = ("preEntryChecklist", "marketContext", "priceStamps", "positionSizing")`.
  - `trader_blocks.market_context_snapshot(memo: dict | None = None) -> dict` → `{"capturedAt": iso, "fields": {"regime", "exposure", "breadth", "spy", "qqq", "vix"}}`, each field `{"value", "source", "asOf", "missing", "detail"}`; for `spy`/`qqq`/`vix` `value` is `{"price", "changePct"}`.
  - `trader_blocks.BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]]`, merged into `journal_styles.BLOCK_BUILDERS`.
  - `GET /api/j2/trader-blocks/market-context` → the snapshot.
- Produces (client): `BLOCK_KINDS` rows with `label`, `search`, `settings[].optionLabels`; `blockSearch(id) -> string | null`.

- [ ] **Step 1: Write the failing tests**

`tests/test_trader_blocks.py`:

```python
"""P2a trader blocks, server half: builders, the market context snapshot, the read route."""
from __future__ import annotations

import importlib
import os
import tempfile
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


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


NOW = datetime(2026, 10, 13, 14, 30, tzinfo=timezone.utc)


def test_every_trader_block_has_a_catalog_row_and_a_builder():
    from api.services.journal_two import journal_styles as js, trader_blocks as tb
    assert set(tb.BLOCK_IDS) <= js.KNOWN_BLOCKS
    assert set(js.BLOCK_BUILDERS) == js.KNOWN_BLOCKS
    for bid in tb.BLOCK_IDS:
        assert js._BLOCK_BY_ID[bid]["search"].startswith("[")


@pytest.mark.parametrize("bid", ["preEntryChecklist", "marketContext", "priceStamps", "positionSizing"])
def test_each_builder_makes_a_body_the_editor_can_build(bid, monkeypatch, db_path):
    from api.services.journal_two import journal_styles as js, notes, trader_blocks as tb
    monkeypatch.setattr(tb, "market_context_snapshot", lambda memo=None: {"capturedAt": "x", "fields": {}})
    kind = js._BLOCK_BY_ID[bid]
    block = {"block": bid, "enabled": True, "settings": {s["key"]: s["default"] for s in kind["settings"]}}
    node, reason = js.BLOCK_BUILDERS[bid](block, {"ticker": None, "now": NOW, "memo": {}})
    assert reason is None and node["attrs"]["widgetId"] == bid
    assert node["attrs"]["searchText"] == kind["search"]
    body = notes._validate_body_json({"type": "doc", "content": [node]})
    notes._refuse_unbuildable(body)                                      # raises if the editor could not build it


def test_settings_flow_into_params():
    from api.services.journal_two import journal_styles as js
    node, _ = js.BLOCK_BUILDERS["priceStamps"]({"block": "priceStamps", "settings": {"on": "yes"}},
                                              {"ticker": None, "now": NOW, "memo": {}})
    assert node["attrs"]["params"] == {"on": "yes"}


def test_market_context_labels_every_gap_and_never_invents(monkeypatch):
    from api.services.journal_two import regime, trader_blocks as tb
    monkeypatch.setattr(regime, "_read_exposure", lambda: None)
    monkeypatch.setattr(tb, "_cached_quote", lambda sym: None)
    snap = tb.market_context_snapshot({})
    assert set(snap["fields"]) == {"regime", "exposure", "breadth", "spy", "qqq", "vix"}
    for name, f in snap["fields"].items():
        assert f["value"] is None and f["missing"], name


def test_market_context_reads_the_regime_and_a_cached_quote(monkeypatch):
    from api.services.journal_two import regime, trader_blocks as tb
    monkeypatch.setattr(regime, "_read_exposure", lambda: {"score": 95, "as_of": "2026-10-13"})
    monkeypatch.setattr(tb, "_cached_quote", lambda sym: {"price": 600.5, "change_pct": 0.8} if sym == "SPY" else None)
    snap = tb.market_context_snapshot({})
    assert snap["fields"]["regime"]["value"] == "green"
    assert snap["fields"]["exposure"]["value"] == 95.0
    assert snap["fields"]["spy"]["value"] == {"price": 600.5, "changePct": 0.8}
    assert snap["fields"]["qqq"]["missing"] == "not_quoted"


def test_route_off_free_paid(db_path, monkeypatch):
    from api.routers import notebook_journal_styles as r
    from api.services.journal_two import trader_blocks as tb
    monkeypatch.setattr(tb, "market_context_snapshot", lambda memo=None: {"capturedAt": "t", "fields": {}})
    app = FastAPI()
    app.include_router(r.router)
    url = "/api/j2/trader-blocks/market-context"
    monkeypatch.delenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", raising=False)
    assert TestClient(app).get(url).status_code == 404
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "free"}
    assert TestClient(app).get(url).status_code == 402
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "pro"}
    got = TestClient(app).get(url)
    assert got.status_code == 200 and got.json() == {"capturedAt": "t", "fields": {}}
```

In `tests/test_journal_styles_store.py`, change the `shape` lambda in `test_the_client_block_catalog_equals_the_server_catalog` (`:45`) so the `search` line is part of the pinned fact:

```python
    shape = lambda kinds: [(k["id"], k.get("search"),
                            [(s["key"], list(s["options"]), s["default"]) for s in k["settings"]])
                           for k in kinds]
```

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_trader_blocks.py tests/test_journal_styles_store.py -q > "$TEMP/p2a-t3.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL (`No module named ... trader_blocks`).

- [ ] **Step 3: Create `trader_blocks.py`**

```python
"""Trader blocks (Notebook P2 Tier 1, spec §P2): the server half.

A trader block is a widgetEmbed whose widgetId is a block id (docs/notebook/p1-verify-before-building.md
§a). This module builds the node a style composes and READS the market data a block shows.

⛔ NOTHING HERE WRITES A NOTE. A block's state changes only through an editor transaction (spec §P2
integrity rule); the composer places the node this module builds, and journal_styles writes the note
in its one insert. tests/test_trader_blocks_no_note_door.py reads this file and fails on any j2_notes
write or any call to a notes write function.
⛔ NO VENDOR CALL ON A REQUEST PATH. The snapshot reads the regime from the wire cache, breadth through
entry_context's cached-only reader, and quotes from the live-price cache only. A cold source is a
labelled gap (`missing`), never a fetch (docs/notebook/p2-verify-before-building.md §V4, §V5).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Callable

BLOCK_IDS = ("preEntryChecklist", "marketContext", "priceStamps", "positionSizing")

#: The regime ids regime.classify_regime answers (journal_two/regime.py), in severity order.
REGIME_IDS = ("green", "amber", "orange", "red")
#: The house words (the sizing table's keys) for each regime id. YELLOW is the house word for amber.
HOUSE_REGIME = {"green": "GREEN", "amber": "YELLOW", "orange": "ORANGE", "red": "RED"}

_INDEXES = (("spy", "SPY"), ("qqq", "QQQ"), ("vix", "VIX"))


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _field(value: Any = None, *, source: str | None = None, as_of: Any = None,
           missing: str | None = None, detail: str | None = None) -> dict:
    return {"value": value, "source": source, "asOf": as_of, "missing": missing, "detail": detail}


def _cached_quote(sym: str) -> dict | None:
    """The live-price cache's entry for `sym`, or None. Cache only (live_prices.py `_px_key`)."""
    try:
        from api.routers import live_prices
        return live_prices.cache.get(live_prices._px_key(sym))
    except Exception:  # noqa: BLE001 -- a read of a cache never fails a note
        return None


def market_context_snapshot(memo: dict | None = None) -> dict:
    """Regime, UCT exposure, breadth, SPY/QQQ/VIX: frozen, sourced and dated (spec §P2 item 3)."""
    from api.services.journal_two import regime as regime_mod
    now = datetime.now(timezone.utc)
    memo = {} if memo is None else memo
    cur = regime_mod.get_current_regime()
    if cur.get("regime") is None:
        reg = _field(missing="no_wire", detail="The morning wire has not published an exposure rating yet.")
        exp = _field(missing="no_wire", detail="The morning wire has not published an exposure rating yet.")
    else:
        reg = _field(cur["regime"], source="UCT Exposure Rating", as_of=cur.get("asOf"))
        exp = _field(cur["score"], source="UCT Exposure Rating", as_of=cur.get("asOf"))
    try:
        from api.services.journal_two import entry_context
        breadth = entry_context._breadth_field(memo)
    except Exception:  # noqa: BLE001
        breadth = _field(missing="unavailable")
    fields = {"regime": reg, "exposure": exp, "breadth": breadth}
    for key, sym in _INDEXES:
        q = _cached_quote(sym)
        if q and q.get("price") is not None:
            fields[key] = _field({"price": q.get("price"), "changePct": q.get("change_pct")},
                                 source="live price", as_of=q.get("observed_at"))
        else:
            fields[key] = _field(missing="not_quoted", detail=f"No {sym} quote was in the cache.")
    return {"capturedAt": _iso(now), "fields": fields}


def _node(block_id: str, params: dict, ctx: dict) -> dict:
    from api.services.journal_two import journal_styles as js
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": block_id, "embedId": uuid.uuid4().hex, "mode": "snapshot", "params": params,
        "capturedAt": _iso(ctx["now"]), "annotations": [], "caption": None,
        "layout": {"width": "full", "height": None}, "fallback": None,
        "searchText": js._BLOCK_BY_ID[block_id]["search"],
    }}


def _settings(block: dict) -> dict:
    return block.get("settings") or {}


def build_pre_entry_checklist(block: dict, ctx: dict):
    s = _settings(block)
    return _node("preEntryChecklist", {"setup": "", "includeRules": s.get("includeRules", "yes"),
                                       "requireAll": s.get("requireAll", "no"), "checked": []}, ctx), None


def build_market_context(block: dict, ctx: dict):
    snap = market_context_snapshot(ctx.setdefault("memo", {}))
    return _node("marketContext", {"fields": _settings(block).get("fields", "all"), "snapshot": snap}, ctx), None


def build_price_stamps(block: dict, ctx: dict):
    return _node("priceStamps", {"on": _settings(block).get("on", "no")}, ctx), None


def build_position_sizing(block: dict, ctx: dict):
    from api.services.journal_two import regime as regime_mod
    cur = regime_mod.get_current_regime()
    params = {"grade": _settings(block).get("grade", "A")}
    if cur.get("regime") in HOUSE_REGIME:
        params.update({"regime": HOUSE_REGIME[cur["regime"]], "regimeAsOf": cur.get("asOf") or ""})
    return _node("positionSizing", params, ctx), None


BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]] = {
    "preEntryChecklist": build_pre_entry_checklist,
    "marketContext": build_market_context,
    "priceStamps": build_price_stamps,
    "positionSizing": build_position_sizing,
}
```

- [ ] **Step 4: Catalog rows and builders in `journal_styles.py`**

Replace `BLOCK_KINDS` (`:51-53`) with:

```python
BLOCK_KINDS: tuple[dict, ...] = (
    {"id": "chart", "settings": ({"key": "tf", "options": ("D", "W", "60", "15", "5"), "default": "D"},)},
    # P2 Tier 1 (part a). `search` is the node's searchText, set by the builder and by the client insert.
    {"id": "preEntryChecklist", "search": "[pre-entry checklist]", "settings": (
        {"key": "includeRules", "options": ("yes", "no"), "default": "yes"},
        {"key": "requireAll", "options": ("no", "yes"), "default": "no"})},
    {"id": "marketContext", "search": "[market context]", "settings": (
        {"key": "fields", "options": ("all", "regime", "indexes"), "default": "all"},)},
    {"id": "priceStamps", "search": "[price stamps]", "settings": (
        {"key": "on", "options": ("no", "yes"), "default": "no"},)},
    {"id": "positionSizing", "search": "[position sizing]", "settings": (
        {"key": "grade", "options": ("A", "A+", "B"), "default": "A"},)},
)
```

Replace `BLOCK_BUILDERS` (`:646-647`) with:

```python
#: block id -> builder. ⛔ Every id in BLOCK_KINDS has a builder (railed); P2 adds both together.
from api.services.journal_two import trader_blocks as _tb  # noqa: E402 -- after BLOCK_KINDS, no cycle
BLOCK_BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]] = {
    "chart": _build_chart, **_tb.BUILDERS}
```

`trader_blocks` imports `journal_styles` only inside `_node` (at call time), so there is no import cycle at load.

In `compose`, give builders a shared memo for the market-wide reads: change `ctx = {"ticker": ticker, "now": now or datetime.now(timezone.utc)}` to

```python
        ctx = {"ticker": ticker, "now": now or datetime.now(timezone.utc), "memo": {}}
```

and in `_plan` change `ctx = {"ticker": row["ticker"], "now": datetime.now(timezone.utc)}` the same way.

- [ ] **Step 5: The client catalog**

Replace `app/src/pages/journal-2-0/lib/journalBlocks.js` with:

```js
// The blocks a journal style can switch on (spec P1.1/P1.2, P2). A block id IS a widget id: a block
// is a widgetEmbed node with that widgetId (docs/notebook/p1-verify-before-building.md §a). P2 adds
// rows here AND in journal_styles.BLOCK_KINDS (with a builder).
// ⛔ ONE FACT IN TWO FILES, pinned by tests/test_journal_styles_store.py through Node (ids, `search`,
// settings keys, options, defaults). Labels and optionLabels are the client's own words. NO IMPORTS.
const YES_NO = Object.freeze({ yes: 'Yes', no: 'No' })
export const BLOCK_KINDS = Object.freeze([
  Object.freeze({
    id: 'chart',
    label: 'Chart of the note’s ticker',
    settings: Object.freeze([
      Object.freeze({ key: 'tf', label: 'Timeframe', options: Object.freeze(['D', 'W', '60', '15', '5']), default: 'D' }),
    ]),
  }),
  Object.freeze({
    id: 'preEntryChecklist',
    label: 'Pre-entry checklist',
    search: '[pre-entry checklist]',
    settings: Object.freeze([
      Object.freeze({ key: 'includeRules', label: 'Include my before-entry rules', options: Object.freeze(['yes', 'no']), default: 'yes', optionLabels: YES_NO }),
      Object.freeze({ key: 'requireAll', label: 'Warn in Log Trade until every item is ticked', options: Object.freeze(['no', 'yes']), default: 'no', optionLabels: YES_NO }),
    ]),
  }),
  Object.freeze({
    id: 'marketContext',
    label: 'Market context',
    search: '[market context]',
    settings: Object.freeze([
      Object.freeze({ key: 'fields', label: 'Show', options: Object.freeze(['all', 'regime', 'indexes']), default: 'all',
        optionLabels: Object.freeze({ all: 'Everything', regime: 'Regime, exposure and breadth', indexes: 'SPY, QQQ and VIX' }) }),
    ]),
  }),
  Object.freeze({
    id: 'priceStamps',
    label: 'Price stamps',
    search: '[price stamps]',
    settings: Object.freeze([
      Object.freeze({ key: 'on', label: 'Stamp prices as I write', options: Object.freeze(['no', 'yes']), default: 'no', optionLabels: YES_NO }),
    ]),
  }),
  Object.freeze({
    id: 'positionSizing',
    label: 'Position sizing',
    search: '[position sizing]',
    settings: Object.freeze([
      Object.freeze({ key: 'grade', label: 'Setup grade', options: Object.freeze(['A', 'A+', 'B']), default: 'A' }),
    ]),
  }),
])

const TF_WORDS = { D: 'Daily', W: 'Weekly', 60: '1 hour', 15: '15 minutes', 5: '5 minutes' }
export const tfWord = (tf) => TF_WORDS[tf] || String(tf)

/** A block's member-facing name; an id this bundle does not know reads as a newer-version block. */
export function blockLabel(id) {
  const k = BLOCK_KINDS.find((b) => b.id === id)
  return k ? k.label : `A block from a newer version (${id})`
}

/** The node's searchText for a block id (the server builder writes the same line). */
export function blockSearch(id) {
  return BLOCK_KINDS.find((b) => b.id === id)?.search || null
}

/** The word a style setting's option shows in the editor. */
export function optionWord(setting, option) {
  return setting?.optionLabels?.[option] ?? tfWord(option)
}
```

In `StyleEditor.jsx`, change the option rendering at `:278` from `{tfWord(o)}` to `{optionWord(s, o)}`, and add `optionWord` to the `journalBlocks` import at `:14`. Run `npx vitest run src/pages/journal-2-0/components/notebook/styles/StylesManager.test.jsx` after; it must stay green (the chart's options still read through `tfWord`).

- [ ] **Step 6: The read route**

In `api/routers/notebook_journal_styles.py`, add to the module docstring's route table:

```
  GET    /api/j2/trader-blocks/market-context           the market context a block freezes (P2a)
```

and the route (below the other GETs):

```python
@router.get("/trader-blocks/market-context")
def trader_market_context(user: dict = Depends(require_paid)) -> dict[str, Any]:
    """Read-only (spec §P2 item 3): regime, exposure, breadth, SPY/QQQ/VIX from the caches, each
    sourced and dated or labelled missing. The block freezes it into its own params."""
    from api.services.journal_two import trader_blocks
    return trader_blocks.market_context_snapshot()
```

- [ ] **Step 7: Contract fixture**

In `tools/notebook_contract_fixtures.py`, at the end of `journal_styles(w)` (before any free-plan record), add:

```python
    w.as_user(who)
    w.record("trader-blocks.market-context", "GET", "/api/j2/trader-blocks/market-context",
             case="success", expect=200)
```

- [ ] **Step 8: Run**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/notebook_contract_fixtures.py > "$TEMP/p2a-t3-gen.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_trader_blocks.py tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_update.py tests/test_notebook_journal_styles_router.py tests/test_notebook_contract_fixtures.py -q > "$TEMP/p2a-t3.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass. The router's route sweeps include the new GET (401 and 404 cases) without edits.

- [ ] **Step 9: Mutation-prove the catalog rail**

Capture `journalBlocks.js`. Change `search: '[market context]'` to `search: '[market]'`. `test_the_client_block_catalog_equals_the_server_catalog` must FAIL. Restore by bytes; check the sha.

- [ ] **Step 10: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add api/services/journal_two/trader_blocks.py api/services/journal_two/journal_styles.py app/src/pages/journal-2-0/lib/journalBlocks.js app/src/pages/journal-2-0/components/notebook/styles/StyleEditor.jsx api/routers/notebook_journal_styles.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_trader_blocks.py tests/test_journal_styles_store.py
git commit -F - -- api/services/journal_two/trader_blocks.py api/services/journal_two/journal_styles.py app/src/pages/journal-2-0/lib/journalBlocks.js app/src/pages/journal-2-0/components/notebook/styles/StyleEditor.jsx api/routers/notebook_journal_styles.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_trader_blocks.py tests/test_journal_styles_store.py <<'MSG'
feat(notebook): P2a trader block catalog rows, builders and the market context read

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 4: `builtin:regime_at_write`, a captured property

Rests on R-P2-6 and Review Focus 4.

**Files:**
- Modify: `api/services/journal_two/note_properties.py` (`BUILTIN_PROPERTY_DEFS` `:73`, `BUILTIN_USER_SET_IDS` `:118`, `set_note_properties` `:421-467`)
- Modify: `api/services/journal_two/notes.py` (`create_note` `:3263`, its call `:3319`; `update_note`'s call `:3767`)
- Modify: `api/services/journal_two/journal_styles.py` (`compose`, `create_styled_note`)
- Modify (per V7): `app/src/pages/journal-2-0/components/notebook/PropertiesSection.jsx`
- Test: `tests/test_regime_at_write.py` (new)

**Interfaces:**
- Produces: `note_properties.REGIME_AT_WRITE = "builtin:regime_at_write"`; `BUILTIN_CAPTURED_IDS`; `set_note_properties(..., captured: str = "refuse")` where `captured` is `"refuse" | "drop" | "keep"`; `notes.create_note(..., captured_properties: str = "drop")`.
- Rule: a member PUT carrying the property answers 400; a template or plain create DROPS it; the composer and a version restore KEEP it.

- [ ] **Step 1: Write the failing tests**

`tests/test_regime_at_write.py`:

```python
"""R-P2-6: builtin:regime_at_write is written once by the composer, never by a member, kept by a restore."""
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


def _red(monkeypatch):
    from api.services.journal_two import regime
    monkeypatch.setattr(regime, "_read_exposure", lambda: {"score": 10, "as_of": "2026-10-13"})


def _style_with_context(user="u1"):
    from api.services.journal_two import journal_styles as js
    return js.create_style(user, {"name": "Ctx", "kindId": "thesis",
                                  "blocks": [{"block": "marketContext", "enabled": True, "settings": {}}]})


def test_a_styled_note_records_the_regime_it_was_written_in(db_path, monkeypatch):
    from api.services.journal_two import journal_styles as js
    _red(monkeypatch)
    s = _style_with_context()
    n, _ = js.create_styled_note("u1", {"styleId": s["id"]})
    assert n["propertiesJson"]["builtin:regime_at_write"] == "red"


def test_no_context_block_no_property(db_path, monkeypatch):
    from api.services.journal_two import journal_styles as js
    _red(monkeypatch)
    n, _ = js.create_styled_note("u1", {"styleId": "builtin:weekly_review"})
    assert "builtin:regime_at_write" not in (n["propertiesJson"] or {})


def test_a_member_cannot_write_it(db_path, monkeypatch):
    from api.services.journal_two import notes, note_properties as np
    n = notes.create_note("u1", {"title": "x"})
    with pytest.raises(np.PropertyValidationError):
        notes.update_note("u1", n["id"], {"properties": {"builtin:regime_at_write": "green"}}, client_schema=4)


def test_a_plain_create_drops_it(db_path):
    from api.services.journal_two import notes
    n = notes.create_note("u1", {"title": "x"}, properties={"builtin:regime_at_write": "green",
                                                            "builtin:confidence": "high"})
    assert n["propertiesJson"] == {"builtin:confidence": "high"}


def test_a_version_restore_keeps_the_captured_regime(db_path, monkeypatch):
    from api.services.journal_two import journal_styles as js, notes
    _red(monkeypatch)
    s = _style_with_context()
    n, _ = js.create_styled_note("u1", {"styleId": s["id"]})
    n2 = notes.update_note("u1", n["id"], {"title": "edited"}, client_schema=4, force_version=True)
    versions = notes.list_note_versions("u1", n["id"])
    oldest = versions[-1]
    restored = notes.restore_note_version("u1", n["id"], oldest["id"], expected_updated_at=n2["updatedAt"])
    assert restored["propertiesJson"]["builtin:regime_at_write"] == "red"


def test_the_def_is_listed_and_read_only():
    from api.services.journal_two import note_properties as np
    d = np._BUILTIN_BY_ID["builtin:regime_at_write"]
    assert d["source"] == "captured" and d["type"] == "select"
    assert [o["id"] for o in d["options"]] == ["green", "amber", "orange", "red"]
    assert "builtin:regime_at_write" not in np.BUILTIN_USER_SET_IDS
```

(`notes.list_note_versions` name: read `grep -n "^def list_note_versions\|^def get_note_versions" api/services/journal_two/notes.py` first and use the name it prints; the versions router `tests/test_journal_two_notes_versions_router.py` uses the same function.)

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_regime_at_write.py -q > "$TEMP/p2a-t4.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL (no such def).

- [ ] **Step 3: The definition and the captured modes**

In `note_properties.py`, append to `BUILTIN_PROPERTY_DEFS` (after the `NOTE_KIND_PROPERTY` entry):

```python
    # Notebook P2 (R-P2-6): the regime the note was WRITTEN in, captured once by the composer from its
    # market context block. ⛔ source "captured": no member write sets it; a restore keeps it.
    {
        "id": "builtin:regime_at_write", "name": "Regime when written", "type": "select", "source": "captured",
        "options": [{"id": "green", "label": "Green", "color": "green"},
                    {"id": "amber", "label": "Yellow", "color": "amber"},
                    {"id": "orange", "label": "Orange", "color": "amber"},
                    {"id": "red", "label": "Red", "color": "red"}],
    },
```

Below `BUILTIN_USER_SET_IDS` add:

```python
REGIME_AT_WRITE = "builtin:regime_at_write"
BUILTIN_CAPTURED_IDS = frozenset(d["id"] for d in BUILTIN_PROPERTY_DEFS if d["source"] == "captured")
```

Change `set_note_properties`'s signature to `(user_id, note_id, patch, conn, *, replace: bool = False, captured: str = "refuse")`, add to its docstring: "`captured` decides a captured built-in in `patch`: `refuse` (a member write, 400), `drop` (a create from a template or a payload) or `keep` (the composer, a version restore).", and replace the loop's first branch with:

```python
    for property_id, value in patch.items():
        if property_id in BUILTIN_CAPTURED_IDS:
            if captured == "drop":
                continue
            if captured != "keep":
                raise PropertyValidationError(f"{property_id} is not a settable property")
            prop_def = _builtin_def(user_id, property_id, conn)
        elif is_builtin_property_id(property_id):
            if property_id not in BUILTIN_USER_SET_IDS:
                raise PropertyValidationError(f"{property_id} is not a settable property")
            prop_def = _builtin_def(user_id, property_id, conn)
        else:
```

(the `else:` body is unchanged).

- [ ] **Step 4: Thread the mode through `notes.py`**

`create_note`: add the keyword `captured_properties: str = "drop"` after `style_stamp`, document it beside `properties` ("INTERNAL: how a captured built-in in `properties` is treated; only the journal styles composer passes `keep`"), and change `:3319` to:

```python
                properties_json = set_note_properties(user_id, new_id, properties, conn, replace=True,
                                                      captured=captured_properties)
```

`update_note`, `:3767`: a restore (the replace form, `propertiesReplace`, restore-only per its own comment) keeps; a member patch refuses:

```python
                new_properties_json = set_note_properties(user_id, note_id, raw, conn, replace=replace,
                                                          captured="keep" if replace else "refuse")
```

- [ ] **Step 5: The composer captures it**

In `journal_styles.compose`, after `props[_nk().NOTE_KIND_PROPERTY] = style["kindId"]`, add:

```python
        from api.services.journal_two import note_properties as np_
        reg = _captured_regime(doc["content"])
        if reg:
            props[np_.REGIME_AT_WRITE] = reg
```

and a module-level helper beside `_present`:

```python
def _captured_regime(content: list) -> str | None:
    """The regime id frozen in the first market context block of a composed body (R-P2-6), or None."""
    stack = list(content or [])
    while stack:
        n = stack.pop(0)
        if not isinstance(n, dict):
            continue
        a = n.get("attrs") or {}
        if n.get("type") == "widgetEmbed" and a.get("widgetId") == "marketContext":
            v = (((a.get("params") or {}).get("snapshot") or {}).get("fields") or {}).get("regime") or {}
            return v.get("value") if v.get("value") in ("green", "amber", "orange", "red") else None
        if isinstance(n.get("content"), list):
            stack[0:0] = n["content"]
    return None
```

In `create_styled_note`, pass the mode on the create:

```python
        note = notes_service.create_note(
            user_id, base, conn, properties=composed["properties"], captured_properties="keep",
            style_stamp=(composed["styleId"], composed["styleVersion"], composed["kindId"]))
```

`compose` is also used by `preview` (writes nothing) and the update path's `insertsOutline` branch, which writes `bodyJson` only (`patch["bodyJson"] = compose(...)["bodyJson"]`), so the property is set on creation only, as the spec says ("On note creation, captures").

- [ ] **Step 6: The Properties section (per V7)**

If V7 found that non-`user_set` built-ins already render read-only and are never offered in "Add property", change nothing and say so in the commit message. Otherwise, in `PropertiesSection.jsx`, add `'captured'` to the source test that renders a built-in read-only, and add a vitest case to `PropertiesSection.test.jsx` (or the file V7 names): "a captured built-in renders its option label and offers no editor and no Add".

- [ ] **Step 7: Run**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_regime_at_write.py tests/test_journal_styles_compose.py tests/test_journal_styles_create.py tests/test_journal_two_properties_router.py tests/test_journal_two_notes_versions_router.py tests/test_note_kind_property.py tests/test_journal_two_note_templates_router.py tests/test_notebook_template_gallery.py -q > "$TEMP/p2a-t4.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass.

- [ ] **Step 8: Mutation-prove the restore**

Capture `notes.py`. Change `captured="keep" if replace else "refuse"` to `captured="refuse"`. `test_a_version_restore_keeps_the_captured_regime` must FAIL with a 400-class `PropertyValidationError`. Restore by bytes; check the sha.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add api/services/journal_two/note_properties.py api/services/journal_two/notes.py api/services/journal_two/journal_styles.py tests/test_regime_at_write.py
git commit -F - -- api/services/journal_two/note_properties.py api/services/journal_two/notes.py api/services/journal_two/journal_styles.py tests/test_regime_at_write.py <<'MSG'
feat(notebook): builtin:regime_at_write, captured by the composer, refused to members, kept by a restore

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

(Add `PropertiesSection.jsx` and its test to both lists if Step 6 changed them.)

---

### Task 5: The pre-entry record for an open position (Log Trade, server half)

Rests on R-P2-7.

**Files:**
- Modify: `api/services/journal_two/trader_blocks.py` (append)
- Modify: `api/routers/notebook_journal_styles.py` (one PUT)
- Modify: `api/routers/journal_two.py` (`get_trade_adherence_route`, `:1008-1020`)
- Modify: `tools/notebook_contract_fixtures.py`
- Test: `tests/test_trader_blocks_pre_entry.py` (new), `tests/test_trader_blocks_no_note_door.py` (new)

**Interfaces:**
- Produces: `PUT /api/j2/trader-blocks/positions/{position_id}/pre-entry`, body `{setup: str|null, checkedRuleIds: [str], totalRules: int}` → the stored adherence record; 404 for a position that is not the caller's. `trader_blocks.PRE_ENTRY_PREFIX = "pos:"`; `trader_blocks.save_pre_entry(user_id, position_id, setup, checked, total) -> dict | None`.
- Changes: `GET /api/j2/trades/{trade_id}/adherence` answers the `pos:<positionId>` record when the trade has none of its own.

- [ ] **Step 1: Write the failing tests**

`tests/test_trader_blocks_pre_entry.py`:

```python
"""R-P2-7: ticks made in Log Trade for an OPEN position carry to the closed trade's adherence card."""
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


def _position(user="u1", pid="p1"):
    from api.services.auth_db import get_connection
    c = get_connection()
    c.execute("INSERT INTO j2_positions (id, user_id, symbol, side, shares, entry_price, entry_date, stop_price,"
              " context_at_entry, created_at, updated_at) VALUES (?, ?, 'NVDA', 'Long', 10, 100, '2026-10-13',"
              " 95, '{}', 'now', 'now')", (pid, user))
    c.commit()
    c.close()


def _app(plan="pro"):
    from api.routers import notebook_journal_styles as r
    app = FastAPI()
    app.include_router(r.router)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": plan}
    return TestClient(app)


def test_put_stores_under_the_position_ref(db_path):
    from api.services.journal_two import adherence_store
    _position()
    got = _app().put("/api/j2/trader-blocks/positions/p1/pre-entry",
                     json={"setup": "VCP", "checkedRuleIds": ["r1"], "totalRules": 3})
    assert got.status_code == 200
    rec = adherence_store.get_adherence("u1", "pos:p1")
    assert rec["checkedRuleIds"] == ["r1"] and rec["totalRules"] == 3


def test_a_foreign_position_is_404(db_path):
    _position(user="u2", pid="p9")
    got = _app().put("/api/j2/trader-blocks/positions/p9/pre-entry", json={"setup": None, "checkedRuleIds": [], "totalRules": 0})
    assert got.status_code == 404


def test_bad_body_is_400(db_path):
    _position()
    got = _app().put("/api/j2/trader-blocks/positions/p1/pre-entry", json={"checkedRuleIds": "r1", "totalRules": 1})
    assert got.status_code == 400


def test_the_closed_trade_reads_the_position_record_when_it_has_none(db_path, monkeypatch):
    from api.routers import journal_two
    from api.services.journal_two import adherence_store
    adherence_store.upsert_adherence("u1", "pos:p1", "VCP", ["r1"], 2)
    monkeypatch.setattr(journal_two.trades_service, "get_trade_detail",
                        lambda uid, tid: {"tradeRef": "id:t1", "positionId": "p1"})
    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1"}
    assert TestClient(app).get("/api/j2/trades/t1/adherence").json()["checkedRuleIds"] == ["r1"]
    adherence_store.upsert_adherence("u1", "id:t1", "VCP", ["r1", "r2"], 2)
    assert TestClient(app).get("/api/j2/trades/t1/adherence").json()["checkedRuleIds"] == ["r1", "r2"]
```

(The `INSERT INTO j2_positions` column list must match `db.py`'s `j2_positions` NOT NULL columns; read `grep -n "CREATE TABLE IF NOT EXISTS j2_positions" -A 20 api/services/journal_two/db.py` and the `_PHASE_2_ALTERS` rows for `j2_positions` NOT NULL defaults before running, and adjust the list to what the table requires.)

`tests/test_trader_blocks_no_note_door.py`:

```python
"""Spec §P2 integrity rule, server half: trader_blocks.py writes no note. Read by AST, with controls."""
from __future__ import annotations

import ast
from pathlib import Path

SRC = Path("api/services/journal_two/trader_blocks.py")
NOTE_WRITERS = {"create_note", "update_note", "append_widget_embed", "append_financial_fact",
                "append_document_excerpt", "restore_note", "restore_note_version", "patch_note_tags"}


def problems(src: str) -> list[str]:
    out = []
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            low = node.value.lower()
            if "update j2_notes" in low or "insert into j2_notes" in low or "delete from j2_notes" in low:
                out.append(f"SQL on j2_notes: {node.value[:60]}")
        if isinstance(node, ast.Attribute) and node.attr in NOTE_WRITERS:
            out.append(f"calls a note writer: {node.attr}")
        if isinstance(node, ast.ImportFrom) and node.module and node.module.endswith("notes"):
            out += [f"imports a note writer: {a.name}" for a in node.names if a.name in NOTE_WRITERS]
    return out


def test_trader_blocks_writes_no_note():
    src = SRC.read_text(encoding="utf-8")
    assert "def market_context_snapshot" in src                    # non-vacuity: the real file
    assert problems(src) == []


def test_control_a_planted_write_is_seen():
    assert problems('conn.execute("UPDATE j2_notes SET title = ?")')
    assert problems("notes_service.update_note(u, n, {})")
    assert problems("from api.services.journal_two.notes import create_note")
    assert problems("x = notes.get_note(u, n)") == []              # a read is not a write
```

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_trader_blocks_pre_entry.py tests/test_trader_blocks_no_note_door.py -q > "$TEMP/p2a-t5.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: the pre-entry tests FAIL (404 on the PUT, the fallback missing); the door rail passes already (it guards from now on).

- [ ] **Step 3: The service function**

Append to `trader_blocks.py`:

```python
# ── Log Trade's checklist for an OPEN position (R-P2-7) ─────────────────────────────────────
PRE_ENTRY_PREFIX = "pos:"


def save_pre_entry(user_id: str, position_id: str, setup: str | None, checked: list[str],
                   total: int) -> dict | None:
    """The ticks made in Log Trade, stored in the adherence store under `pos:<position id>` (the
    closed trade's adherence read falls back to it). None when the position is not this member's."""
    from api.services.auth_db import get_connection
    from api.services.journal_two import adherence_store
    c = get_connection()
    try:
        own = c.execute("SELECT 1 FROM j2_positions WHERE id = ? AND user_id = ?", (position_id, user_id)).fetchone()
    finally:
        c.close()
    if own is None:
        return None
    return adherence_store.upsert_adherence(user_id, PRE_ENTRY_PREFIX + position_id, setup, checked, total)
```

- [ ] **Step 4: The route**

In `notebook_journal_styles.py` (docstring row `PUT /api/j2/trader-blocks/positions/{position_id}/pre-entry  Log Trade's ticks for an open position (P2a)`):

```python
@router.put("/trader-blocks/positions/{position_id}/pre-entry")
def trader_pre_entry(position_id: str, body: dict = Depends(paid_body),
                     user: dict = Depends(require_paid)) -> dict[str, Any]:
    """R-P2-7: writes the adherence store, never a note."""
    from api.services.journal_two import trader_blocks
    setup = body.get("setup")
    checked = body.get("checkedRuleIds", [])
    total = body.get("totalRules", 0)
    if setup is not None and not isinstance(setup, str):
        raise HTTPException(status_code=400, detail="setup must be a string")
    if not isinstance(checked, list) or not all(isinstance(x, str) for x in checked):
        raise HTTPException(status_code=400, detail="checkedRuleIds must be a list of strings")
    if isinstance(total, bool) or not isinstance(total, int) or total < 0:
        raise HTTPException(status_code=400, detail="totalRules must be a non-negative integer")
    rec = trader_blocks.save_pre_entry(user["id"], position_id, setup, checked, total)
    if rec is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return rec
```

- [ ] **Step 5: The fallback on the closed trade's read**

In `api/routers/journal_two.py`, `get_trade_adherence_route`, replace its last line with:

```python
    own = adherence_store.get_adherence(user["id"], detail["tradeRef"])
    if own is None and detail.get("positionId"):
        # Notebook P2 (R-P2-7): the ticks made in Log Trade while the position was open.
        return adherence_store.get_adherence(user["id"], "pos:" + str(detail["positionId"]))
    return own
```

- [ ] **Step 6: Contract fixture**

In `journal_styles(w)` in `tools/notebook_contract_fixtures.py`, create a position for `who` with the same column list the test used, then:

```python
    w.record("trader-blocks.pre-entry", "PUT", "/api/j2/trader-blocks/positions/pos-styles-1/pre-entry",
             case="success", expect=200, json_body={"setup": "VCP", "checkedRuleIds": ["r1"], "totalRules": 2})
    w.record("trader-blocks.pre-entry.not-found", "PUT", "/api/j2/trader-blocks/positions/nope/pre-entry",
             case="error", expect=404, json_body={"setup": None, "checkedRuleIds": [], "totalRules": 0})
```

- [ ] **Step 7: Run**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/notebook_contract_fixtures.py > "$TEMP/p2a-t5-gen.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_trader_blocks_pre_entry.py tests/test_trader_blocks_no_note_door.py tests/test_trader_blocks.py tests/test_notebook_journal_styles_router.py tests/test_notebook_contract_fixtures.py tests/test_journal_two_adherence_router.py -q > "$TEMP/p2a-t5.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

(`tests/test_journal_two_adherence_router.py`: confirm the file name with `ls tests | grep -i adherence` and use the one that exists.) Expected: all pass.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add api/services/journal_two/trader_blocks.py api/routers/notebook_journal_styles.py api/routers/journal_two.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_trader_blocks_pre_entry.py tests/test_trader_blocks_no_note_door.py
git commit -F - -- api/services/journal_two/trader_blocks.py api/routers/notebook_journal_styles.py api/routers/journal_two.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_trader_blocks_pre_entry.py tests/test_trader_blocks_no_note_door.py <<'MSG'
feat(notebook): Log Trade pre-entry ticks for an open position carry to the closed trade's adherence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 6: The client block platform, and the no-new-door rail

**Files:**
- Modify: `app/src/widgets/registry.js` (four manifests in `PANEL_MANIFESTS`, after `modelbook`; `validatePanelManifest`)
- Modify: `app/src/widgets/registry.test.js` (`CAPTURE_ONLY`; a `block` case)
- Modify: `app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx` (the dispatcher)
- Create: `app/src/pages/journal-2-0/components/notebook/blocks/BlockNodeView.jsx`, `Blocks.module.css`, `useBlockParams.js`, `blockStates.jsx`, and stub bodies `PreEntryChecklistBlock.jsx`, `MarketContextBlock.jsx`, `PriceStampsBlock.jsx`, `PositionSizingBlock.jsx`
- Create: `app/src/pages/journal-2-0/lib/blocks/blockDoors.test.js`
- Test: `app/src/pages/journal-2-0/components/notebook/blocks/BlockNodeView.test.jsx`, `blockParams.test.jsx`
- Modify: `scripts/gate_shards.py` (`GATE_READ_PATHS`), `app/src/components/screener/reachable.test.js` only if it reds on a stub (it should not: each stub is imported by the map)

**Interfaces:**
- Produces:
  - registry manifests `preEntryChecklist`, `marketContext`, `priceStamps`, `positionSizing`: `captureOnly: true`, `block: true`, all menus false, `reconstructable: true`, `liveCapable: false`, `plainText: () => '<the catalog search line>'`.
  - `isTraderBlock(widgetId) -> boolean` exported from `registry.js` (`WIDGET_REGISTRY[id]?.block === true`).
  - `BlockNodeView({node, editor, updateAttributes, deleteNode, selected})` (default export) and `BLOCK_COMPONENTS` (named).
  - A block body receives `{ params, setParams, editable, editor, attrs }`. `setParams(patch) -> boolean` merges `patch` into `params` in ONE `updateAttributes` call that also re-derives `searchText`; it returns `false` (and writes nothing) when the editor is not editable.
  - `blockStates.jsx` exports `BlockEmpty({title, children})`, `BlockError({onRetry})` (sentence `BLOCK_ERROR_SENTENCE = "This block couldn't load. Your note is safe."`), `BlockNeedsSwitch({what})` (sentence `"This block needs {what}, which is not on for you."`), `BlockLoading()`.

- [ ] **Step 1: Write the failing tests**

`app/src/pages/journal-2-0/components/notebook/blocks/blockParams.test.jsx`:

```jsx
// Spec §P2 integrity rule: a block's state changes ONLY through an editor transaction.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useBlockParams } from './useBlockParams'

function Probe({ attrs, updateAttributes, editable }) {
  const setParams = useBlockParams({ attrs, updateAttributes, editable })
  return <button type="button" onClick={() => setParams({ checked: ['r1'] })}>tick</button>
}

describe('useBlockParams', () => {
  beforeEach(() => { globalThis.fetch = vi.fn() })

  it('a tick is ONE transaction through updateAttributes, no fetch', () => {
    const updateAttributes = vi.fn()
    const attrs = { widgetId: 'preEntryChecklist', params: { setup: 'VCP', checked: [] } }
    render(<Probe attrs={attrs} updateAttributes={updateAttributes} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'tick' }))
    expect(updateAttributes).toHaveBeenCalledTimes(1)
    expect(updateAttributes.mock.calls[0][0]).toEqual({
      params: { setup: 'VCP', checked: ['r1'] }, searchText: '[pre-entry checklist]',
    })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('a reader (not editable) writes nothing', () => {
    const updateAttributes = vi.fn()
    render(<Probe attrs={{ widgetId: 'preEntryChecklist', params: {} }} updateAttributes={updateAttributes} editable={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'tick' }))
    expect(updateAttributes).not.toHaveBeenCalled()
  })

  it('two ticks in a row read the LATEST params, never a stale render', () => {
    const calls = []
    let attrs = { widgetId: 'preEntryChecklist', params: { checked: [] } }
    const updateAttributes = (a) => { calls.push(a); attrs = { ...attrs, params: a.params } }
    function Two() {
      const set = useBlockParams({ attrs, updateAttributes, editable: true })
      return <button type="button" onClick={() => { set({ checked: ['a'] }); set({ setup: 'VCP' }) }}>two</button>
    }
    render(<Two />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'two' })) })
    expect(calls[1].params).toEqual({ checked: ['a'], setup: 'VCP' })
  })
})
```

`app/src/pages/journal-2-0/components/notebook/blocks/BlockNodeView.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children, ...p }) => <div {...p}>{children}</div> }))
vi.mock('./PreEntryChecklistBlock', () => ({ default: () => { throw new Error('boom') } }))
vi.mock('./PriceStampsBlock', () => ({ default: ({ params }) => <p>stamps {params.on}</p> }))

import BlockNodeView from './BlockNodeView'
import { BLOCK_ERROR_SENTENCE } from './blockStates'

const node = (widgetId, params = {}) => ({ attrs: { widgetId, params, searchText: '[x]' } })
const editor = (extra = {}) => ({ isEditable: true, storage: { uctJournalWidgets: { noteId: 'n1', ...extra } } })

describe('BlockNodeView', () => {
  it('renders the block body with its params, labelled by the block name', async () => {
    render(<BlockNodeView node={node('priceStamps', { on: 'yes' })} editor={editor()} updateAttributes={() => {}} />)
    expect(await screen.findByText('stamps yes')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Price stamps' })).toBeTruthy()
  })
  it('a body that throws shows the error state and never blanks the note', async () => {
    render(<BlockNodeView node={node('preEntryChecklist')} editor={editor()} updateAttributes={() => {}} />)
    expect(await screen.findByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Pre-entry checklist' })).toBeTruthy()
  })
  it('on a public share page it renders the block line only (nothing auth-scoped mounts)', () => {
    render(<BlockNodeView node={node('priceStamps', { on: 'yes' })} editor={editor({ shareView: true })} updateAttributes={() => {}} />)
    expect(screen.getByText('[x]')).toBeTruthy()
    expect(screen.queryByText('stamps yes')).toBeNull()
  })
})
```

`app/src/pages/journal-2-0/lib/blocks/blockDoors.test.js`:

```js
/**
 * ⛔⛔ SPEC §P2 INTEGRITY RULE, CLIENT HALF — "No block may own a second write door."
 *
 * Every file under components/notebook/blocks/ and lib/blocks/ (tests excluded) is parsed with acorn:
 *   ① no request may be sent with a method other than GET, except the NAMED exceptions below, each of
 *     which writes something that is NOT a note (and the door census, doorEnumeration.test.js ①/②,
 *     still pins the server to seven note-advancing functions, so a note door cannot hide here);
 *   ② no block file imports the offline write layer (lib/offline/*) or the styles writes
 *     (lib/journalStyles.js);
 *   ③ `updateAttributes(` is called in exactly ONE block file, useBlockParams.js: every block's state
 *     change is that one editor transaction.
 * Controls below plant each failure in memory and prove the rail sees it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..')
const DIRS = [join(REPO, 'app/src/pages/journal-2-0/components/notebook/blocks'),
  join(REPO, 'app/src/pages/journal-2-0/lib/blocks')]
const rel = (p) => relative(REPO, p).split(sep).join('/')
const P = Parser.extend(jsx())

/** method+url literal pairs that are allowed to write, each with why it is not a note door. */
const WRITE_EXCEPTIONS = {
  'app/src/pages/journal-2-0/lib/blocks/priceStamps.js':
    'POST /api/j2/notes/{id}/facts creates a j2_fact_observations row (create_fact_observation); it never '
    + 'advances the note. The stamp node lands through an editor transaction (spec §P2 item 4).',
  'app/src/pages/journal-2-0/lib/blocks/logTradeChecklist.js':
    'PUT /api/j2/trader-blocks/positions/{id}/pre-entry and PUT /api/j2/trades/{id}/adherence write the '
    + 'adherence store (R-P2-7), never a note.',
}

function files() {
  const out = []
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else out.push(p) } }
  for (const d of DIRS) { try { walk(d) } catch { /* created by this task */ } }
  return out.filter((p) => /\.(js|jsx)$/.test(p) && !/\.test\.jsx?$/.test(p))
}

export function problemsIn(file, src) {
  const out = []
  const ast = P.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'ImportDeclaration' && /lib\/offline\/|journalStyles(\.js)?$/.test(n.source.value)) {
      out.push(`IMPORT ${file}: ${n.source.value}`)
    }
    if (n.type === 'CallExpression') {
      const callee = n.callee.type === 'Identifier' ? n.callee.name : n.callee.property?.name
      if (callee === 'updateAttributes' && !file.endsWith('/useBlockParams.js')) out.push(`UPDATE ${file}`)
      if (callee === 'fetch' && n.arguments[1]?.type === 'ObjectExpression') {
        const m = n.arguments[1].properties.find((p) => p.key?.name === 'method')
        const method = m?.value?.type === 'Literal' ? String(m.value.value).toUpperCase() : (m ? '?' : 'GET')
        if (method !== 'GET' && !WRITE_EXCEPTIONS[file]) out.push(`WRITE ${file}: ${method}`)
      }
    }
    for (const k of Object.keys(n)) {
      const v = n[k]
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v)
    }
  }
  visit(ast)
  return out
}

describe('⛔⛔ no block owns a second write door', () => {
  it('the real block files: nothing found, and the rail read them', () => {
    const fs = files()
    expect(fs.map(rel)).toContain('app/src/pages/journal-2-0/components/notebook/blocks/useBlockParams.js')
    const problems = fs.flatMap((p) => problemsIn(rel(p), readFileSync(p, 'utf8')))
    expect(problems).toEqual([])
  })
  it('every write exception still names a file that exists and writes', () => {
    const fs = files().map(rel)
    for (const f of Object.keys(WRITE_EXCEPTIONS)) expect(fs, f).toContain(f)
  })
  it('CONTROL — a planted PUT, an offline import and a stray updateAttributes are each seen', () => {
    const f = 'app/src/pages/journal-2-0/components/notebook/blocks/X.jsx'
    expect(problemsIn(f, "fetch('/api/j2/notes/1', { method: 'PUT' })")).toEqual([`WRITE ${f}: PUT`])
    expect(problemsIn(f, "import { settleNoteWrite } from '../../../lib/offline/settleNoteWrite'")).toHaveLength(1)
    expect(problemsIn(f, 'updateAttributes({ params: {} })')).toEqual([`UPDATE ${f}`])
    expect(problemsIn(f, "fetch('/api/j2/regime')")).toEqual([])
    expect(problemsIn(f, "fetch(u, { method: m })")).toEqual([`WRITE ${f}: ?`])
  })
})
```

In `registry.test.js`, extend the `CAPTURE_ONLY` constant (find it with `grep -n "const CAPTURE_ONLY" app/src/widgets/registry.test.js`) to the declaration order after Task 6: `['screener', 'cot', 'modelbook', 'preEntryChecklist', 'marketContext', 'priceStamps', 'positionSizing']`, and add:

```js
  it('⛔ P2: a trader block is capture-only, bound in no menu, and marked block', () => {
    const blocks = WIDGET_IDS.filter((id) => WIDGET_REGISTRY[id].block === true)
    expect(blocks).toEqual(['preEntryChecklist', 'marketContext', 'priceStamps', 'positionSizing'])
    for (const id of blocks) {
      expect(WIDGET_REGISTRY[id].captureOnly).toBe(true)
      expect(isTraderBlock(id)).toBe(true)
    }
    expect(isTraderBlock('chart')).toBe(false)
    expect(() => registerPanel('x', { ...WIDGET_REGISTRY.priceStamps, captureOnly: false })).toThrow(/block entry must be captureOnly/)
  })
```

(import `isTraderBlock` beside the file's other registry imports).

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/components/notebook/blocks src/pages/journal-2-0/lib/blocks src/widgets/registry.test.js > "$TEMP/p2a-t6.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL (modules missing).

- [ ] **Step 3: Registry manifests**

In `registry.js`, add to `validatePanelManifest` (after the `captureOnly` boolean check):

```js
  if (manifest.block !== undefined && manifest.block !== true) problems.push('block must be true when present')
  if (manifest.block === true && manifest.captureOnly !== true) problems.push('a block entry must be captureOnly')
```

Add to `PANEL_MANIFESTS` after `modelbook` (search lines mirror `journalBlocks.js` `search`; Task 6's own test pins that `paramsPlainText(id, {})` equals `blockSearch(id)` for each):

```js
  // ── Notebook P2 (Tier 1, part a): trader blocks. ⛔ A block is a capture-only kind bound by the
  // Notebook alone (blocks/BlockNodeView.jsx). Its member state is `params`, written only by
  // blocks/useBlockParams.js (spec §P2 integrity rule; lib/blocks/blockDoors.test.js).
  preEntryChecklist: blockManifest('Pre-entry checklist', [
    { key: 'setup', type: 'string' },
    { key: 'includeRules', type: 'enum', options: ['yes', 'no'], default: 'yes' },
    { key: 'requireAll', type: 'enum', options: ['no', 'yes'], default: 'no' },
    { key: 'checked', type: 'json', default: [] },
  ], '[pre-entry checklist]'),
  marketContext: blockManifest('Market context', [
    { key: 'fields', type: 'enum', options: ['all', 'regime', 'indexes'], default: 'all' },
    { key: 'snapshot', type: 'json' },
  ], '[market context]'),
  priceStamps: blockManifest('Price stamps', [
    { key: 'on', type: 'enum', options: ['no', 'yes'], default: 'no' },
  ], '[price stamps]'),
  positionSizing: blockManifest('Position sizing', [
    { key: 'entry', type: 'number' },
    { key: 'stop', type: 'number' },
    { key: 'grade', type: 'enum', options: ['A', 'A+', 'B'], default: 'A' },
    { key: 'accountSize', type: 'number' },
    { key: 'regime', type: 'enum', options: ['GREEN', 'YELLOW', 'ORANGE', 'RED'] },
    { key: 'regimeAsOf', type: 'string' },
  ], '[position sizing]'),
```

and, above `PANEL_MANIFESTS`:

```js
/** A trader block's manifest (Notebook P2): one shape, so each entry costs its params and words only. */
function blockManifest(label, paramsSchema, line) {
  return {
    labels: { header: label, menu: label, tab: label },
    defaults: { w: 6, h: 4, minW: 3, minH: 2 },
    placement: { family: 'panel', fill: 'narrow' },
    menus: { workspace: false, tab: false, mobile: false, journal: false },
    captureOnly: true,
    block: true,
    themeFollow: true,
    paramsSchema,
    plainText: () => line,
    reconstructable: true,
    liveCapable: false,
  }
}
```

and below `widgetMeta`:

```js
/** Is this widget id a Notebook trader block (rendered by blocks/BlockNodeView, not the embed chrome)? */
export function isTraderBlock(id) {
  return WIDGET_REGISTRY[id]?.block === true
}
```

- [ ] **Step 4: The dispatcher in `WidgetEmbedView.jsx`**

Rename the current `export default function WidgetEmbedView(...)` to `function EmbedNodeView(...)` (body unchanged). Add, below `EMBED_COMPONENTS`:

```jsx
// Notebook P2: a trader block is NOT an embed. It has no toolbar, no archive and no resize; its state
// is its params, changed only through blocks/useBlockParams.js. Lazy, so a note with no block loads none
// of it. An older bundle never reaches here: it has no registry row, so the block keeps the
// "needs a newer version" card (docs/notebook/p1-verify-before-building.md §b).
const BlockNodeView = lazyLeaf(() => import('./blocks/BlockNodeView'))

export default function WidgetEmbedView(props) {
  if (isTraderBlock(props.node?.attrs?.widgetId)) {
    return (
      <Suspense fallback={<NodeViewWrapper className={styles.frame} data-widget-embed-view="block-loading" />}>
        <BlockNodeView {...props} />
      </Suspense>
    )
  }
  return <EmbedNodeView {...props} />
}
```

and add `isTraderBlock` to the `widgetMeta` import from `'../../../../widgets/registry'`. Two component TYPES (not a branch inside one) keep every hook of `EmbedNodeView` in a stable order.

- [ ] **Step 5: The block files**

`blocks/useBlockParams.js`:

```js
// ⛔⛔ THE ONE WAY A BLOCK CHANGES ITS STATE (spec §P2 integrity rule). One TipTap updateAttributes
// call = one editor transaction, so the change rides the note's existing save path (autosave -> outbox
// -> compare-and-set) and nothing else. lib/blocks/blockDoors.test.js fails on any other
// updateAttributes call in a block file.
import { useCallback, useRef } from 'react'
import { paramsPlainText } from '../../../../../widgets/registry'

export function useBlockParams({ attrs, updateAttributes, editable }) {
  // `latest` holds the params the NEXT write merges into: the node's own params, or the value this
  // hook just wrote if the node has not re-rendered with it yet (two ticks inside one event).
  // When the node's params object changes (our write landed, or a rebase from another tab), the
  // node's value wins again.
  const latest = useRef(attrs?.params || {})
  const seen = useRef(attrs?.params)
  if (attrs?.params !== seen.current) {
    seen.current = attrs?.params
    latest.current = attrs?.params || {}
  }
  return useCallback((patch) => {
    if (!editable || typeof updateAttributes !== 'function') return false
    const params = { ...latest.current, ...patch }
    latest.current = params
    updateAttributes({ params, searchText: paramsPlainText(attrs.widgetId, params) })
    return true
  }, [editable, updateAttributes, attrs?.widgetId])
}
```

`blocks/blockStates.jsx`:

```jsx
import styles from './Blocks.module.css'

export const BLOCK_ERROR_SENTENCE = "This block couldn't load. Your note is safe."

export function BlockLoading() {
  return <p className={styles.muted} aria-live="polite">Loading…</p>
}
export function BlockEmpty({ title, children }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {children}
    </div>
  )
}
export function BlockError({ onRetry }) {
  return (
    <div className={styles.error} role="status">
      <p>{BLOCK_ERROR_SENTENCE}</p>
      {onRetry && <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={onRetry}>Try again</button>}
    </div>
  )
}
export function BlockNeedsSwitch({ what }) {
  return <p className={styles.muted} role="status">{`This block needs ${what}, which is not on for you.`}</p>
}
```

`blocks/BlockNodeView.jsx`:

```jsx
import { Component, Suspense } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { lazyLeaf } from '../../../lib/lazyChunk'
import { blockLabel } from '../../../lib/journalBlocks'
import { useBlockParams } from './useBlockParams'
import { BlockError, BlockLoading } from './blockStates'
import styles from './Blocks.module.css'

/** id -> body. Each body is its own lazy chunk; Tasks 7, 9, 10 and 11 replace the stub files. */
export const BLOCK_COMPONENTS = {
  preEntryChecklist: lazyLeaf(() => import('./PreEntryChecklistBlock')),
  marketContext: lazyLeaf(() => import('./MarketContextBlock')),
  priceStamps: lazyLeaf(() => import('./PriceStampsBlock')),
  positionSizing: lazyLeaf(() => import('./PositionSizingBlock')),
}

class BlockBoundary extends Component {
  constructor(p) { super(p); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? <BlockError onRetry={() => this.setState({ failed: false })} />
      : this.props.children
  }
}

export default function BlockNodeView({ node, editor, updateAttributes, deleteNode, selected }) {
  const attrs = node?.attrs || {}
  const shareView = !!editor?.storage?.uctJournalWidgets?.shareView
  const editable = editor?.isEditable !== false && !shareView
  const setParams = useBlockParams({ attrs, updateAttributes, editable })
  const label = blockLabel(attrs.widgetId)
  const Body = BLOCK_COMPONENTS[attrs.widgetId]
  return (
    <NodeViewWrapper className={`${styles.block} ${selected ? styles.selected : ''}`}
      data-widget-embed-view={attrs.widgetId} contentEditable={false}>
      <div role="group" aria-label={label} className={styles.inner}>
        <div className={styles.head}>
          <span className={styles.title}>{label}</span>
          {editable && deleteNode && (
            <button type="button" className={`btn btn-ghost ${styles.tap}`} aria-label={`Remove ${label}`} onClick={() => deleteNode()}>
              Remove
            </button>
          )}
        </div>
        {shareView || !Body ? <p className={styles.muted}>{attrs.searchText || label}</p> : (
          <BlockBoundary>
            <Suspense fallback={<BlockLoading />}>
              <Body params={attrs.params || {}} setParams={setParams} editable={editable} editor={editor} attrs={attrs} />
            </Suspense>
          </BlockBoundary>
        )}
      </div>
    </NodeViewWrapper>
  )
}
```

`blocks/Blocks.module.css`:

```css
.block { margin: 12px 0; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elev, var(--bg)); }
.selected { outline: 2px solid var(--accent); }
.inner { padding: 10px 12px; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.title { font-weight: 600; font-size: 13px; letter-spacing: .02em; }
.muted { color: var(--text-muted); font-size: 13px; margin: 4px 0; }
.empty { display: grid; gap: 6px; }
.emptyTitle { margin: 0; font-size: 13px; }
.error { display: flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: 13px; }
.row { display: flex; align-items: center; gap: 8px; min-height: 32px; }
.tap { min-height: 32px; }
@media (max-width: 1024px) {
  .row, .tap { min-height: var(--tap-min); }
}
@media (max-width: 640px) {
  .inner { padding: 8px; }
  .head { flex-wrap: wrap; }
}
```

(The tokens `--border`, `--text-muted`, `--accent` and `--tap-min` are the ones P1's styles surfaces use; `styles/tokens.reachable.test.js` fails on a token that does not exist, so run it in Step 6 and use `--bg` alone if `--bg-elev` is not a token.)

Each stub body (`PreEntryChecklistBlock.jsx`, `MarketContextBlock.jsx`, `PriceStampsBlock.jsx`, `PositionSizingBlock.jsx`), replaced by its own task:

```jsx
import { BlockEmpty } from './blockStates'

export default function PriceStampsBlock() {
  return <BlockEmpty title="This block is being built." />
}
```

(with the file's own component name).

- [ ] **Step 6: Gate read path**

`blockDoors.test.js` reads only `app/src`. But `doorEnumeration.test.js` rail ② walks every module under `api/services/journal_two/` (its header: "a SERVICE function (any module under api/services/journal_two/ ...)"), so it now reads `trader_blocks.py`; and P1 had to add nine such paths after the fact (commit `3704241461`, "GATE_READ_PATHS names the nine paths P1's vitest rails read"). Ask the read-set rail instead of guessing:

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_gate_shards.py -q -k "read_set" > "$TEMP/p2a-t6-readset.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Read the totals line (a `-k` that matches nothing collects zero tests: the log must show the read-set tests ran). For every path `test_the_read_set_covers_every_root_relative_path_the_suite_reads` names as missing, add it to `GATE_READ_PATHS`, exact path, under a comment:

```python
    # ⛔ Notebook P2a: read by app/src/pages/journal-2-0/lib/offline/doorEnumeration.test.js rail ②,
    # which walks every api/services/journal_two/ module for note-advancing calls. Exact path.
    "api/services/journal_two/trader_blocks.py",
```

Re-run until it is green. If it names nothing, record "no new Python path is read by a vitest rail" in the commit message.

- [ ] **Step 7: Run**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/components/notebook/blocks src/pages/journal-2-0/lib/blocks src/widgets/registry.test.js src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx src/pages/journal-2-0/components/notebook/WidgetEmbedView.toolbarMore.test.jsx src/components/screener/reachable.test.js src/styles/tokens.reachable.test.js src/styles/tapFloor.test.js src/surfaces/panelSet.test.js > "$TEMP/p2a-t6.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass.

- [ ] **Step 8: Mutation-prove the platform**

Capture `useBlockParams.js`. Replace the `updateAttributes(...)` call with `fetch('/api/j2/notes/x', { method: 'PUT' })`. Both `blockParams.test.jsx` ("ONE transaction ... no fetch") and `blockDoors.test.js` ("the real block files") must FAIL. Restore by bytes; check the sha. Capture `WidgetEmbedView.jsx`; make the dispatcher always return `<EmbedNodeView/>`; `BlockNodeView.test.jsx` keeps passing (it renders BlockNodeView directly), so add this case to `WidgetEmbedView.unknownKind.test.jsx` first and confirm it goes red under the mutation:

```jsx
it('a trader block goes to BlockNodeView, never the embed chrome (no "Chart tools" toolbar)', async () => {
  // render WidgetEmbedView with node.attrs.widgetId 'priceStamps' the way this file renders embeds
  // and assert: queryByRole('toolbar', { name: 'Chart tools' }) is null, and the group 'Price stamps' appears
})
```

Write that case in full using the file's own render helper (read it first); it must FAIL under the mutation and PASS restored.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add app/src/widgets/registry.js app/src/widgets/registry.test.js app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx app/src/pages/journal-2-0/components/notebook/blocks app/src/pages/journal-2-0/lib/blocks scripts/gate_shards.py
git commit -F - -- app/src/widgets/registry.js app/src/widgets/registry.test.js app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx app/src/pages/journal-2-0/components/notebook/blocks app/src/pages/journal-2-0/lib/blocks scripts/gate_shards.py <<'MSG'
feat(notebook): trader block platform -- registry kinds, BlockNodeView, one write path, no-new-door rail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 7: Pre-entry checklist block

Spec §P2 item 1. Settings (R-P2-4): `includeRules`, `requireAll`; the setup is chosen in the note.

**Files:**
- Create: `app/src/pages/journal-2-0/lib/blocks/checklistItems.js`, `checklistItems.test.js`
- Replace: `app/src/pages/journal-2-0/components/notebook/blocks/PreEntryChecklistBlock.jsx`
- Test: `app/src/pages/journal-2-0/components/notebook/blocks/PreEntryChecklistBlock.test.jsx`

**Interfaces:**
- Consumes: `useJ2Settings()` → `{ settings }` (`LogTradeButton.jsx:64`, `const { settings } = useJ2Settings()`); `settings.setupRules` is `{setupName: [{id, label}]}` (`accounts.py:71-72`); `settings.setups`; `useJ2SelectedAccount()` → `{ accountId }`; `useJournalRules(accountId)` → `{ rules }`.
- Produces (`checklistItems.js`):
  - `checklistItems({ settings, rules, setup, includeRules }) -> [{ id, label, source: 'setup'|'rule' }]` — the setup's rules, then the account's active rules whose `beforeEntry === true` (rule ids prefixed `rule:`), each id once.
  - `uncheckedItems(items, checked) -> items` and `checklistSummary(items, checked) -> { done, total }`. Only CURRENT item ids count (a stale stored id drops out, like `AdherenceChecklist.jsx`).
- Part b sets `beforeEntry` on rules (part b Task 2). Until then `includeRules` includes no rule, and the block says so.

- [ ] **Step 1: Write the failing tests**

`checklistItems.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { checklistItems, uncheckedItems, checklistSummary } from './checklistItems'

const settings = { setups: ['VCP', 'Flag'], setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }, { id: 's2', label: 'Tight closes' }] } }
const rules = [{ id: 'r1', label: 'No trades in the first 5 minutes', beforeEntry: true },
  { id: 'r2', label: 'Journal every loss', beforeEntry: false }, { id: 'r3', label: 'Old rule' }]

describe('checklistItems', () => {
  it('the setup rules, then before-entry rules only', () => {
    expect(checklistItems({ settings, rules, setup: 'VCP', includeRules: 'yes' }).map((i) => i.id))
      .toEqual(['s1', 's2', 'rule:r1'])
  })
  it('includeRules no leaves the rules out; an unknown setup has no setup items', () => {
    expect(checklistItems({ settings, rules, setup: 'VCP', includeRules: 'no' }).map((i) => i.id)).toEqual(['s1', 's2'])
    expect(checklistItems({ settings, rules, setup: 'Gone', includeRules: 'yes' }).map((i) => i.id)).toEqual(['rule:r1'])
  })
  it('a stale checked id never counts', () => {
    const items = checklistItems({ settings, rules, setup: 'VCP', includeRules: 'no' })
    expect(checklistSummary(items, ['s1', 'deleted'])).toEqual({ done: 1, total: 2 })
    expect(uncheckedItems(items, ['s1']).map((i) => i.id)).toEqual(['s2'])
  })
  it('missing settings or rules are empty, never a throw', () => {
    expect(checklistItems({ settings: null, rules: null, setup: '', includeRules: 'yes' })).toEqual([])
  })
})
```

`PreEntryChecklistBlock.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let SETTINGS = { setups: ['VCP'], setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }, { id: 's2', label: 'Tight closes' }] } }
let RULES = []
vi.mock('../../../hooks/useJ2Settings', () => ({ default: () => ({ settings: SETTINGS }) }))
vi.mock('../../../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1' }) }))
vi.mock('../../../hooks/useJournalRules', () => ({ default: () => ({ rules: RULES }) }))

import PreEntryChecklistBlock from './PreEntryChecklistBlock'

const base = { setup: 'VCP', includeRules: 'yes', requireAll: 'no', checked: [] }

describe('PreEntryChecklistBlock', () => {
  it('lists the setup checklist as named checkboxes and ticks through setParams only', () => {
    const setParams = vi.fn(() => true)
    render(<PreEntryChecklistBlock params={base} setParams={setParams} editable />)
    const box = screen.getByRole('checkbox', { name: 'Volume dry-up' })
    fireEvent.click(box)
    expect(setParams).toHaveBeenCalledWith({ checked: ['s1'] })
    expect(screen.getByText('0 of 2 ticked')).toBeTruthy()
  })
  it('no setup picked: a named select of the member setups', () => {
    const setParams = vi.fn(() => true)
    render(<PreEntryChecklistBlock params={{ ...base, setup: '' }} setParams={setParams} editable />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Setup for this trade' }), { target: { value: 'VCP' } })
    expect(setParams).toHaveBeenCalledWith({ setup: 'VCP', checked: [] })
  })
  it('no setups yet: says what to do, never an empty box', () => {
    SETTINGS = { setups: [], setupRules: {} }
    render(<PreEntryChecklistBlock params={{ ...base, setup: '' }} setParams={vi.fn()} editable />)
    expect(screen.getByText(/You have no setups yet/)).toBeTruthy()
    SETTINGS = { setups: ['VCP'], setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }] } }
  })
  it('a reader sees the ticks, disabled', () => {
    render(<PreEntryChecklistBlock params={{ ...base, checked: ['s1'] }} setParams={vi.fn()} editable={false} />)
    const box = screen.getByRole('checkbox', { name: 'Volume dry-up' })
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(true)
  })
  it('includeRules yes with no before-entry rules says how to mark one', () => {
    RULES = [{ id: 'r1', label: 'x', beforeEntry: false }]
    render(<PreEntryChecklistBlock params={base} setParams={vi.fn()} editable />)
    expect(screen.getByText(/No rules are marked "before entry" yet/)).toBeTruthy()
    RULES = []
  })
})
```

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/lib/blocks/checklistItems.test.js src/pages/journal-2-0/components/notebook/blocks/PreEntryChecklistBlock.test.jsx > "$TEMP/p2a-t7.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL.

- [ ] **Step 3: `checklistItems.js`**

```js
// The pre-entry checklist's items (spec §P2 item 1): the setup's checklist (settings.setupRules,
// accounts.py "{setupName: [{id, label}]}") plus the account's ACTIVE rules marked "before entry"
// (part b sets `beforeEntry`). Read-only over server data; the block stores only ticked ids.
export function checklistItems({ settings, rules, setup, includeRules }) {
  const out = []
  const seen = new Set()
  const push = (id, label, source) => { if (id && !seen.has(id)) { seen.add(id); out.push({ id, label, source }) } }
  const setupRules = settings?.setupRules?.[setup]
  if (Array.isArray(setupRules)) for (const r of setupRules) push(String(r.id), String(r.label || ''), 'setup')
  if (includeRules === 'yes' && Array.isArray(rules)) {
    for (const r of rules) if (r?.beforeEntry === true) push(`rule:${r.id}`, String(r.label || ''), 'rule')
  }
  return out
}

export function uncheckedItems(items, checked) {
  const on = new Set(Array.isArray(checked) ? checked : [])
  return items.filter((i) => !on.has(i.id))
}

export function checklistSummary(items, checked) {
  const on = new Set(Array.isArray(checked) ? checked : [])
  return { done: items.filter((i) => on.has(i.id)).length, total: items.length }
}
```

- [ ] **Step 4: `PreEntryChecklistBlock.jsx`**

```jsx
import useJ2Settings from '../../../hooks/useJ2Settings'
import useJ2SelectedAccount from '../../../hooks/useJ2SelectedAccount'
import useJournalRules from '../../../hooks/useJournalRules'
import { checklistItems, checklistSummary } from '../../../lib/blocks/checklistItems'
import { BlockEmpty } from './blockStates'
import styles from './Blocks.module.css'

export default function PreEntryChecklistBlock({ params, setParams, editable }) {
  const { settings } = useJ2Settings()
  const { accountId } = useJ2SelectedAccount()
  const { rules } = useJournalRules(params.includeRules === 'yes' ? accountId : null)
  const setups = Array.isArray(settings?.setups) ? settings.setups : []
  const setup = params.setup || ''

  if (!setup) {
    if (!setups.length) {
      return (
        <BlockEmpty title="You have no setups yet. Add your setups and their checklists in Journal settings, then pick one here." />
      )
    }
    return (
      <label className={styles.row}>
        <span>Setup for this trade</span>
        <select aria-label="Setup for this trade" disabled={!editable} value=""
          onChange={(e) => setParams({ setup: e.target.value, checked: [] })}>
          <option value="" disabled>Pick a setup</option>
          {setups.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    )
  }

  const items = checklistItems({ settings, rules, setup, includeRules: params.includeRules })
  const checked = Array.isArray(params.checked) ? params.checked : []
  const { done, total } = checklistSummary(items, checked)
  const noRuleItems = params.includeRules === 'yes' && !items.some((i) => i.source === 'rule')
  const toggle = (id) => {
    const on = new Set(checked)
    if (on.has(id)) on.delete(id)
    else on.add(id)
    setParams({ checked: items.map((i) => i.id).filter((x) => on.has(x)) })
  }

  return (
    <fieldset className={styles.empty}>
      <legend className={styles.muted}>{`Pre-entry checklist for ${setup}`}</legend>
      {!items.length && <p className={styles.muted}>{`No checklist for ${setup} yet. Add its rules in Journal settings, under Setups.`}</p>}
      {items.map((i) => (
        <label key={i.id} className={styles.row}>
          <input type="checkbox" checked={checked.includes(i.id)} disabled={!editable} onChange={() => toggle(i.id)} />
          <span>{i.label}</span>
        </label>
      ))}
      {noRuleItems && <p className={styles.muted}>No rules are marked "before entry" yet. Mark one in My rules to add it here.</p>}
      {total > 0 && <p className={styles.muted} aria-live="polite">{`${done} of ${total} ticked`}</p>}
      {editable && (
        <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={() => setParams({ setup: '', checked: [] })}>
          Change setup
        </button>
      )}
    </fieldset>
  )
}
```

(Hook paths: `blocks/` is `J/components/notebook/blocks`, so `../../../hooks/...` is `J/hooks/...`. Confirm with `ls app/src/pages/journal-2-0/hooks/useJournalRules.js` before running.)

- [ ] **Step 5: Run**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/components/notebook/blocks > "$TEMP/p2a-t7.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass (the door rail included).

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/lib/blocks/checklistItems.js app/src/pages/journal-2-0/lib/blocks/checklistItems.test.js app/src/pages/journal-2-0/components/notebook/blocks/PreEntryChecklistBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/PreEntryChecklistBlock.test.jsx
git commit -F - -- app/src/pages/journal-2-0/lib/blocks/checklistItems.js app/src/pages/journal-2-0/lib/blocks/checklistItems.test.js app/src/pages/journal-2-0/components/notebook/blocks/PreEntryChecklistBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/PreEntryChecklistBlock.test.jsx <<'MSG'
feat(notebook): pre-entry checklist block (setup checklist + before-entry rules, ticks in params)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 8: The checklist in Log Trade (soft warning, opt-in per member)

Spec §P2 item 1 and §7.5 (soft warning only). R-P2-7.

**Files:**
- Create: `app/src/pages/journal-2-0/lib/blocks/logTradeChecklist.js`, `logTradeChecklist.test.js`
- Create: `app/src/pages/journal-2-0/components/LogTradeChecklist.jsx` (lazy), `LogTradeChecklist.test.jsx`
- Modify: `app/src/pages/journal-2-0/components/AddPositionModal.jsx`, `AddTradeModal.jsx`
- Modify: `api/routers/auth.py` (`_PREFERENCE_KEYS`), `app/src/hooks/usePreferences.additionsOnly.test.js` (`BASELINE_KEYS`)

**Interfaces:**
- Consumes: Task 5's route; Task 7's `checklistItems`, `uncheckedItems`.
- Produces:
  - preference key `notebook_log_trade_checklist` (literal), value `'on'`/`'off'` (default off: opt-in).
  - `logTradeChecklist.saveTicks({ kind: 'position'|'trade', id, setup, checked, total }) -> Promise<boolean>`: PUT to `/api/j2/trader-blocks/positions/{id}/pre-entry` or `/api/j2/trades/{id}/adherence`; never throws; a failure returns `false` and the trade stays logged.
  - `<LogTradeChecklist setup settings accountId requireAll checked onChange />` renders the checklist and, when `requireAll` is on and items are unticked, the sentence `"{n} checklist item(s) not ticked. You can still log this trade."` (never disables submit).
- In each modal: when `journalStylesEnabled()` and the preference is `'on'`, the checklist mounts above the submit row; after `onSave` resolves with the created row, `saveTicks` runs once.

- [ ] **Step 1: Write the failing tests**

`logTradeChecklist.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveTicks, softWarning } from './logTradeChecklist'

describe('saveTicks', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) })
  it('an open position writes the pre-entry route', async () => {
    expect(await saveTicks({ kind: 'position', id: 'p1', setup: 'VCP', checked: ['s1'], total: 2 })).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trader-blocks/positions/p1/pre-entry', expect.objectContaining({ method: 'PUT' }))
  })
  it('a closed trade writes its adherence', async () => {
    await saveTicks({ kind: 'trade', id: 't1', setup: 'VCP', checked: [], total: 2 })
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trades/t1/adherence', expect.objectContaining({ method: 'PUT' }))
  })
  it('a failure is false, never a throw', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('offline') })
    expect(await saveTicks({ kind: 'trade', id: 't1', setup: null, checked: [], total: 0 })).toBe(false)
  })
})

describe('softWarning', () => {
  it('only when requireAll is on and something is unticked', () => {
    expect(softWarning({ requireAll: 'yes', unticked: 2 })).toBe('2 checklist items not ticked. You can still log this trade.')
    expect(softWarning({ requireAll: 'yes', unticked: 1 })).toBe('1 checklist item not ticked. You can still log this trade.')
    expect(softWarning({ requireAll: 'no', unticked: 2 })).toBeNull()
    expect(softWarning({ requireAll: 'yes', unticked: 0 })).toBeNull()
  })
})
```

`LogTradeChecklist.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
vi.mock('../hooks/useJournalRules', () => ({ default: () => ({ rules: [] }) }))
import LogTradeChecklist from './LogTradeChecklist'

const settings = { setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }, { id: 's2', label: 'Tight closes' }] } }

describe('LogTradeChecklist', () => {
  it('ticks report up, and the soft warning never disables anything', () => {
    const onChange = vi.fn()
    render(<LogTradeChecklist setup="VCP" settings={settings} accountId="a1" requireAll="yes" checked={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Volume dry-up' }))
    expect(onChange).toHaveBeenCalledWith(['s1'], 2)
    expect(screen.getByRole('status').textContent).toBe('2 checklist items not ticked. You can still log this trade.')
  })
  it('no setup chosen yet: one line, no boxes', () => {
    render(<LogTradeChecklist setup="" settings={settings} accountId="a1" requireAll="no" checked={[]} onChange={vi.fn()} />)
    expect(screen.getByText('Pick a setup to see its pre-entry checklist.')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
```

In `usePreferences.additionsOnly.test.js`, add to `BASELINE_KEYS` beside `notebook_kind_mapping: 'scalar',` (`:133`):

```js
  notebook_log_trade_checklist: 'scalar',
```

In `AddPositionModal.test.jsx`, add (using that file's own render helper and mocks; read it first):

```jsx
it('P2a: with the switch and the preference on, the checklist shows; submit is never disabled by it', async () => {
  // mock lib/journalStylesFlag journalStylesEnabled -> true and usePreferences -> 'on'; pick setup 'VCP';
  // assert the 'Pre-entry checklist' group renders, the submit button is enabled with nothing ticked,
  // and after a successful save fetch was called with '/api/j2/trader-blocks/positions/<new id>/pre-entry'.
})
it('P2a: with the switch off the checklist is absent and no pre-entry write happens', async () => { /* same, flag false */ })
```

Write both in full against the file's helper (the comments say exactly what each asserts), and the same two cases in `AddTradeModal.test.jsx` with `/api/j2/trades/<new id>/adherence`.

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/lib/blocks/logTradeChecklist.test.js src/pages/journal-2-0/components/LogTradeChecklist.test.jsx src/pages/journal-2-0/components/AddPositionModal.test.jsx src/pages/journal-2-0/components/AddTradeModal.test.jsx src/hooks/usePreferences.additionsOnly.test.js > "$TEMP/p2a-t8.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL.

- [ ] **Step 3: `logTradeChecklist.js`**

```js
// Log Trade's pre-entry checklist (spec §P2 item 1, §7.5 soft warning only; R-P2-7). It writes the
// ADHERENCE store, never a note (lib/blocks/blockDoors.test.js names this file as its exception).
export const LOG_TRADE_CHECKLIST_PREF = 'notebook_log_trade_checklist'

export async function saveTicks({ kind, id, setup, checked, total }) {
  const url = kind === 'position'
    ? `/api/j2/trader-blocks/positions/${encodeURIComponent(id)}/pre-entry`
    : `/api/j2/trades/${encodeURIComponent(id)}/adherence`
  try {
    const res = await fetch(url, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup: setup || null, checkedRuleIds: checked, totalRules: total }),
    })
    return res.ok
  } catch {
    return false
  }
}

export function softWarning({ requireAll, unticked }) {
  if (requireAll !== 'yes' || !unticked) return null
  return `${unticked} checklist ${unticked === 1 ? 'item' : 'items'} not ticked. You can still log this trade.`
}
```

- [ ] **Step 4: `LogTradeChecklist.jsx`**

```jsx
import useJournalRules from '../hooks/useJournalRules'
import { checklistItems, uncheckedItems } from '../lib/blocks/checklistItems'
import { softWarning } from '../lib/blocks/logTradeChecklist'
import styles from './notebook/blocks/Blocks.module.css'

export default function LogTradeChecklist({ setup, settings, accountId, requireAll, checked, onChange }) {
  const { rules } = useJournalRules(accountId || null)
  if (!setup) return <p className={styles.muted}>Pick a setup to see its pre-entry checklist.</p>
  const items = checklistItems({ settings, rules, setup, includeRules: 'yes' })
  if (!items.length) return null
  const toggle = (id) => {
    const on = new Set(checked)
    if (on.has(id)) on.delete(id)
    else on.add(id)
    onChange(items.map((i) => i.id).filter((x) => on.has(x)), items.length)
  }
  const warn = softWarning({ requireAll, unticked: uncheckedItems(items, checked).length })
  return (
    <fieldset role="group" aria-label="Pre-entry checklist" className={styles.empty}>
      <legend className={styles.muted}>{`Pre-entry checklist for ${setup}`}</legend>
      {items.map((i) => (
        <label key={i.id} className={styles.row}>
          <input type="checkbox" checked={checked.includes(i.id)} onChange={() => toggle(i.id)} />
          <span>{i.label}</span>
        </label>
      ))}
      {warn && <p role="status" className={styles.muted}>{warn}</p>}
    </fieldset>
  )
}
```

- [ ] **Step 5: Wire both modals**

In `AddPositionModal.jsx` (and the same in `AddTradeModal.jsx`, whose setup state and save handler have their own names: read both files first):

```jsx
import { Suspense } from 'react'
import lazyChunk from '../lib/lazyChunk'
import usePreferences from '../../../hooks/usePreferences'
import { journalStylesEnabled } from '../lib/journalStylesFlag'
import { LOG_TRADE_CHECKLIST_PREF, saveTicks } from '../lib/blocks/logTradeChecklist'
const LogTradeChecklist = lazyChunk(() => import('./LogTradeChecklist'))
```

Inside the component, beside the setup state:

```jsx
  const { prefs } = usePreferences()
  const checklistOn = journalStylesEnabled() && prefs?.[LOG_TRADE_CHECKLIST_PREF] === 'on'
  const [ticks, setTicks] = useState({ checked: [], total: 0 })
```

Render, above the submit row:

```jsx
      {checklistOn && (
        <Suspense fallback={null}>
          <LogTradeChecklist setup={setup} settings={settings} accountId={accountId} requireAll="yes"
            checked={ticks.checked} onChange={(checked, total) => setTicks({ checked, total })} />
        </Suspense>
      )}
```

In the save handler, right after `const created = await onSave(payload)` (`AddPositionModal.jsx:349`) succeeds:

```jsx
      if (checklistOn && created?.id && ticks.total > 0) {
        saveTicks({ kind: 'position', id: created.id, setup, checked: ticks.checked, total: ticks.total })
      }
```

(`kind: 'trade'` in `AddTradeModal.jsx`.) The write is fire-and-forget: a failed tick save never fails or delays the logged trade. `usePreferences`' return shape: P1's plan cited it at `usePreferences.js:385`; read that line and use the name it returns for the prefs map. `accountId`: the modal's own account prop or `useJ2SelectedAccount()` (`AddPositionModal.jsx:115` uses an `accountId`; read its source in the file).

Add the opt-in to the Journal settings where the member sets up setups (`PortfolioSettingsModal.jsx`, the setups section): one checkbox "Show my pre-entry checklist in Log Trade" writing `setPref(LOG_TRADE_CHECKLIST_PREF, on ? 'on' : 'off')`, rendered only while `journalStylesEnabled()`. Test it in `PortfolioSettingsModal.test.jsx` (the checkbox is absent with the switch off, and writes the literal key with it on).

- [ ] **Step 6: The server preference key**

In `api/routers/auth.py` `_PREFERENCE_KEYS`, beside `"notebook_kind_mapping": _PREF_OPAQUE,`:

```python
    # Notebook P2a: Log Trade's pre-entry checklist opt-in ('on' / 'off'), written by
    # PortfolioSettingsModal. Added in the same commit as its writer.
    "notebook_log_trade_checklist": _PREF_OPAQUE,
```

- [ ] **Step 7: Run**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/components/LogTradeChecklist.test.jsx src/pages/journal-2-0/components/AddPositionModal.test.jsx src/pages/journal-2-0/components/AddTradeModal.test.jsx src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx src/hooks/usePreferences.additionsOnly.test.js src/styles/tapFloor.test.js > "$TEMP/p2a-t8.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_auth_preferences.py -q > "$TEMP/p2a-t8-py.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

(`tests/test_auth_preferences.py`: the pytest that reads JS writers against `_PREFERENCE_KEYS` — `test_every_key_the_client_writes_is_still_accepted` per the auth.py comment; find its file with `grep -rln "test_every_key_the_client_writes_is_still_accepted" tests` and run that one.) Expected: all pass.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/lib/blocks/logTradeChecklist.js app/src/pages/journal-2-0/lib/blocks/logTradeChecklist.test.js app/src/pages/journal-2-0/components/LogTradeChecklist.jsx app/src/pages/journal-2-0/components/LogTradeChecklist.test.jsx app/src/pages/journal-2-0/components/AddPositionModal.jsx app/src/pages/journal-2-0/components/AddPositionModal.test.jsx app/src/pages/journal-2-0/components/AddTradeModal.jsx app/src/pages/journal-2-0/components/AddTradeModal.test.jsx app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx app/src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx api/routers/auth.py app/src/hooks/usePreferences.additionsOnly.test.js
git commit -F - -- app/src/pages/journal-2-0/lib/blocks/logTradeChecklist.js app/src/pages/journal-2-0/lib/blocks/logTradeChecklist.test.js app/src/pages/journal-2-0/components/LogTradeChecklist.jsx app/src/pages/journal-2-0/components/LogTradeChecklist.test.jsx app/src/pages/journal-2-0/components/AddPositionModal.jsx app/src/pages/journal-2-0/components/AddPositionModal.test.jsx app/src/pages/journal-2-0/components/AddTradeModal.jsx app/src/pages/journal-2-0/components/AddTradeModal.test.jsx app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx app/src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx api/routers/auth.py app/src/hooks/usePreferences.additionsOnly.test.js <<'MSG'
feat(journal): pre-entry checklist in Log Trade, opt-in, soft warning only; ticks carry to adherence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 9: Market context block

Spec §P2 item 3. R-P2-6.

**Files:**
- Replace: `app/src/pages/journal-2-0/components/notebook/blocks/MarketContextBlock.jsx`
- Create: `app/src/pages/journal-2-0/lib/blocks/marketContextFields.js`, `marketContextFields.test.js`
- Test: `app/src/pages/journal-2-0/components/notebook/blocks/MarketContextBlock.test.jsx`

**Interfaces:**
- Consumes: Task 3's route and snapshot shape.
- Produces: `FIELD_SETS = { all: [...6], regime: ['regime','exposure','breadth'], indexes: ['spy','qqq','vix'] }`; `fieldLines(snapshot, preset) -> [{ key, label, text, missing }]`; regime words `{green: 'Green', amber: 'Yellow', orange: 'Orange', red: 'Red'}`.
- Behaviour: a block with no `snapshot` (inserted by hand) shows a "Capture now" button that GETs the route and writes the snapshot with `setParams` (an explicit action, never on mount). A captured block is frozen: it shows "Captured {time}" and a "Capture again" button. Every field shows its source and as-of, or why it is missing.

- [ ] **Step 1: Write the failing tests**

`marketContextFields.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { fieldLines, FIELD_SETS } from './marketContextFields'

const snap = { capturedAt: '2026-10-13T14:30:00Z', fields: {
  regime: { value: 'orange', source: 'UCT Exposure Rating', asOf: '2026-10-13' },
  exposure: { value: 32.0, source: 'UCT Exposure Rating', asOf: '2026-10-13' },
  breadth: { value: null, missing: 'cache_cold', detail: 'Breadth is not computed yet today.' },
  spy: { value: { price: 600.5, changePct: -0.42 }, source: 'live price' },
  qqq: { value: null, missing: 'not_quoted', detail: 'No QQQ quote was in the cache.' },
  vix: { value: { price: 18.2, changePct: 3.1 } } } }

describe('fieldLines', () => {
  it('formats each field, and says why a missing one is missing', () => {
    const lines = fieldLines(snap, 'all')
    expect(lines.map((l) => l.key)).toEqual(FIELD_SETS.all)
    expect(lines.find((l) => l.key === 'regime').text).toBe('Orange')
    expect(lines.find((l) => l.key === 'exposure').text).toBe('32')
    expect(lines.find((l) => l.key === 'spy').text).toBe('600.50 (-0.42%)')
    expect(lines.find((l) => l.key === 'qqq')).toMatchObject({ missing: true, text: 'No QQQ quote was in the cache.' })
  })
  it('a preset narrows the list', () => {
    expect(fieldLines(snap, 'indexes').map((l) => l.key)).toEqual(['spy', 'qqq', 'vix'])
  })
  it('no snapshot is no lines, never a throw', () => {
    expect(fieldLines(null, 'all')).toEqual([])
  })
})
```

`MarketContextBlock.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MarketContextBlock from './MarketContextBlock'

const SNAP = { capturedAt: '2026-10-13T14:30:00Z', fields: { regime: { value: 'green', source: 'UCT Exposure Rating', asOf: '2026-10-13' } } }

describe('MarketContextBlock', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => SNAP })) })

  it('nothing captured: one button; it reads the route and writes the snapshot through setParams', async () => {
    const setParams = vi.fn(() => true)
    render(<MarketContextBlock params={{ fields: 'all' }} setParams={setParams} editable />)
    expect(globalThis.fetch).not.toHaveBeenCalled()                 // never on mount
    fireEvent.click(screen.getByRole('button', { name: 'Capture now' }))
    await waitFor(() => expect(setParams).toHaveBeenCalledWith({ snapshot: SNAP }))
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trader-blocks/market-context', expect.anything())
  })
  it('a captured block is frozen and dated', () => {
    render(<MarketContextBlock params={{ fields: 'all', snapshot: SNAP }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Green')).toBeTruthy()
    expect(screen.getByText(/Captured/)).toBeTruthy()
  })
  it('a failed capture says so and keeps the note', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }))
    render(<MarketContextBlock params={{ fields: 'all' }} setParams={vi.fn()} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture now' }))
    expect(await screen.findByText("The market context couldn't be read just now. Nothing was changed.")).toBeTruthy()
  })
  it('the switch off: a captured block still renders; capturing says what it needs', () => {
    render(<MarketContextBlock params={{ fields: 'all' }} setParams={vi.fn()} editable switchOff />)
    expect(screen.getByText('This block needs Journal styles, which is not on for you.')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/lib/blocks/marketContextFields.test.js src/pages/journal-2-0/components/notebook/blocks/MarketContextBlock.test.jsx > "$TEMP/p2a-t9.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL.

- [ ] **Step 3: `marketContextFields.js`**

```js
// The market context block's lines (spec §P2 item 3). Read from the FROZEN snapshot only.
export const FIELD_SETS = Object.freeze({
  all: ['regime', 'exposure', 'breadth', 'spy', 'qqq', 'vix'],
  regime: ['regime', 'exposure', 'breadth'],
  indexes: ['spy', 'qqq', 'vix'],
})
const LABELS = { regime: 'Regime', exposure: 'UCT exposure', breadth: 'Above the 50-day', spy: 'SPY', qqq: 'QQQ', vix: 'VIX' }
export const REGIME_WORDS = Object.freeze({ green: 'Green', amber: 'Yellow', orange: 'Orange', red: 'Red' })

function text(key, value) {
  if (key === 'regime') return REGIME_WORDS[value] || String(value)
  if (key === 'exposure') return String(Math.round(Number(value)))
  if (key === 'breadth') return `${Number(value).toFixed(0)}%`
  const pct = Number(value?.changePct)
  return `${Number(value?.price).toFixed(2)}${Number.isFinite(pct) ? ` (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)` : ''}`
}

export function fieldLines(snapshot, preset) {
  const fields = snapshot?.fields
  if (!fields) return []
  return (FIELD_SETS[preset] || FIELD_SETS.all).map((key) => {
    const f = fields[key] || {}
    if (f.value == null) return { key, label: LABELS[key], text: f.detail || 'Not available', missing: true }
    return { key, label: LABELS[key], text: text(key, f.value), missing: false, source: f.source, asOf: f.asOf }
  })
}
```

- [ ] **Step 4: `MarketContextBlock.jsx`**

```jsx
import { useState } from 'react'
import { journalStylesEnabled } from '../../../lib/journalStylesFlag'
import { fieldLines } from '../../../lib/blocks/marketContextFields'
import { BlockNeedsSwitch } from './blockStates'
import styles from './Blocks.module.css'

const FAILED = "The market context couldn't be read just now. Nothing was changed."

export default function MarketContextBlock({ params, setParams, editable, switchOff = !journalStylesEnabled() }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const capture = async () => {
    setBusy(true); setFailed(false)
    try {
      const res = await fetch('/api/j2/trader-blocks/market-context', { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      setParams({ snapshot: await res.json() })
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  const lines = fieldLines(params.snapshot, params.fields)
  const when = params.snapshot?.capturedAt
    ? new Date(params.snapshot.capturedAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })
    : null
  return (
    <div>
      {lines.length > 0 && (
        <dl className={styles.empty}>
          {lines.map((l) => (
            <div key={l.key} className={styles.row}>
              <dt>{l.label}</dt>
              <dd className={l.missing ? styles.muted : undefined} title={l.source ? `${l.source}${l.asOf ? `, as of ${l.asOf}` : ''}` : undefined}>{l.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {when && <p className={styles.muted}>{`Captured ${when} ET`}</p>}
      {failed && <p role="status" className={styles.muted}>{FAILED}</p>}
      {editable && switchOff && !params.snapshot && <BlockNeedsSwitch what="Journal styles" />}
      {editable && !switchOff && (
        <button type="button" className={`btn btn-ghost ${styles.tap}`} disabled={busy} onClick={capture}>
          {params.snapshot ? 'Capture again' : 'Capture now'}
        </button>
      )}
    </div>
  )
}
```

The "Show notes written in this regime" link: add below the lines, per V8's answer, either a `<Link>` to the board URL form V8 found, or the sentence "Open your notes as a Board and group by Regime when written." Test whichever V8 chose in `MarketContextBlock.test.jsx` (one more case, the link's `href` or the sentence).

- [ ] **Step 5: Run**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/components/notebook/blocks > "$TEMP/p2a-t9.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass (the door rail sees only a GET here).

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/lib/blocks/marketContextFields.js app/src/pages/journal-2-0/lib/blocks/marketContextFields.test.js app/src/pages/journal-2-0/components/notebook/blocks/MarketContextBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/MarketContextBlock.test.jsx
git commit -F - -- app/src/pages/journal-2-0/lib/blocks/marketContextFields.js app/src/pages/journal-2-0/lib/blocks/marketContextFields.test.js app/src/pages/journal-2-0/components/notebook/blocks/MarketContextBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/MarketContextBlock.test.jsx <<'MSG'
feat(notebook): market context block (frozen, sourced, dated; captured only by an explicit action)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 10: Price-stamped lines

Spec §P2 item 4. R-P2-2, R-P2-3, Review Focus 2.

**Files:**
- Create: `app/src/pages/journal-2-0/lib/blocks/priceStamps.js`, `priceStamps.test.js`
- Modify: `app/src/pages/journal-2-0/lib/tiptap.js` (`buildExtensions`, `:201`)
- Replace: `app/src/pages/journal-2-0/components/notebook/blocks/PriceStampsBlock.jsx`
- Test: `app/src/pages/journal-2-0/components/notebook/blocks/PriceStampsBlock.test.jsx`

**Interfaces:**
- Produces (`priceStamps.js`):
  - `STAMP_TIMEOUT_MS = 2000`.
  - `stampsOn(doc) -> boolean`: the note holds a `priceStamps` block with `params.on === 'yes'`.
  - `lineTicker(text, noteTicker) -> string | null` (R-P2-3).
  - `PriceStamps` — a TipTap `Extension` named `uctPriceStamps` whose `Enter` shortcut returns `false` (Enter lands first and at once) and schedules a stamp; and whose ProseMirror plugin keeps each pending stamp's line position MAPPED through every later transaction.
  - `requestStamp({ noteId, symbol, signal }) -> Promise<{id} | null>`: `POST /api/j2/notes/{noteId}/facts {ticker, factType: 'price'}` (the `/price` path, `SlashMenu.jsx:391`).
- The stamp is inserted as its OWN transaction, history-closed so it undoes on its own (`closeHistory` from `@tiptap/pm/history`), directly after the line. A fetch that fails, answers after `STAMP_TIMEOUT_MS`, or finds the line deleted inserts nothing.

- [ ] **Step 1: Write the failing tests**

`priceStamps.test.js` (a real TipTap editor in jsdom, so the Enter order of V10 is proved, not assumed):

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../tiptap'
import { stampsOn, lineTicker, STAMP_TIMEOUT_MS } from './priceStamps'

const doc = (on, ...paras) => ({ type: 'doc', content: [
  { type: 'widgetEmbed', attrs: { widgetId: 'priceStamps', params: { on } } },
  ...paras.map((t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })),
] })

function editorWith(content) {
  const ed = new Editor({ extensions: buildExtensions(), content })
  ed.storage.uctJournalWidgets = { noteId: 'n1', noteTicker: 'AMD' }
  return ed
}
const types = (ed) => ed.getJSON().content.map((n) => n.type)
const pressEnterAtEndOf = (ed, index) => {
  let pos = 0
  ed.state.doc.forEach((n, off, i) => { if (i === index) pos = off + n.nodeSize - 1 })
  ed.commands.setTextSelection(pos)
  ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: 'Enter' })))
}

describe('price stamps', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    globalThis.fetch = vi.fn(() => new Promise((r) => setTimeout(() => r({ ok: true, json: async () => ({ fact: { id: 'f1' } }) }), 300)))
  })
  afterEach(() => { vi.useRealTimers() })

  it('lineTicker: a cashtag wins; the note ticker as a bare word counts; otherwise none', () => {
    expect(lineTicker('Bought $NVDA at the open', 'AMD')).toBe('NVDA')
    expect(lineTicker('AMD held the 20 EMA', 'AMD')).toBe('AMD')
    expect(lineTicker('Nothing here', 'AMD')).toBeNull()
  })

  it('Enter lands at once; the stamp lands after the line, as its own step', async () => {
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    expect(types(ed)).toEqual(['widgetEmbed', 'paragraph', 'paragraph'])     // Enter, instantly
    await vi.advanceTimersByTimeAsync(400)
    expect(types(ed)).toEqual(['widgetEmbed', 'paragraph', 'financialFact', 'paragraph'])
    ed.commands.undo()
    expect(types(ed)).toEqual(['widgetEmbed', 'paragraph', 'paragraph'])     // the stamp undoes alone
  })

  it('off by default: no block or on=no stamps nothing and fetches nothing', async () => {
    const ed = editorWith(doc('no', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(stampsOn(ed.state.doc)).toBe(false)
  })

  it('a fetch slower than the timeout inserts nothing', async () => {
    globalThis.fetch = vi.fn((url, { signal }) => new Promise((r, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      setTimeout(() => r({ ok: true, json: async () => ({ fact: { id: 'f1' } }) }), STAMP_TIMEOUT_MS + 500)
    }))
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(STAMP_TIMEOUT_MS + 600)
    expect(types(ed)).not.toContain('financialFact')
  })

  it('a deleted line takes no stamp', async () => {
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    let from = 0, to = 0
    ed.state.doc.forEach((n, off, i) => { if (i === 1) { from = off; to = off + n.nodeSize } })
    ed.chain().deleteRange({ from, to }).run()
    await vi.advanceTimersByTimeAsync(400)
    expect(types(ed)).not.toContain('financialFact')
  })

  it('a moved line takes its stamp where it now is', async () => {
    const ed = editorWith(doc('yes', 'first', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 2)
    ed.chain().insertContentAt(1, { type: 'paragraph', content: [{ type: 'text', text: 'typed above' }] }).run()
    await vi.advanceTimersByTimeAsync(400)
    const json = ed.getJSON().content
    const at = json.findIndex((n) => n.type === 'financialFact')
    expect(json[at - 1].content[0].text).toBe('Long $NVDA here')
  })

  it('a failed fetch inserts nothing and never throws', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 }))
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(100)
    expect(types(ed)).not.toContain('financialFact')
  })
})
```

`PriceStampsBlock.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PriceStampsBlock from './PriceStampsBlock'

describe('PriceStampsBlock', () => {
  it('a named switch; turning it on is one setParams', () => {
    const setParams = vi.fn(() => true)
    render(<PriceStampsBlock params={{ on: 'no' }} setParams={setParams} editable />)
    const sw = screen.getByRole('switch', { name: 'Stamp prices as I write' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    expect(setParams).toHaveBeenCalledWith({ on: 'yes' })
  })
  it('says how it works', () => {
    render(<PriceStampsBlock params={{ on: 'yes' }} setParams={vi.fn()} editable />)
    expect(screen.getByText(/Write \$NVDA and press Enter/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/lib/blocks/priceStamps.test.js src/pages/journal-2-0/components/notebook/blocks/PriceStampsBlock.test.jsx > "$TEMP/p2a-t10.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL.

- [ ] **Step 3: `priceStamps.js`**

```js
// Price-stamped lines (spec §P2 item 4; R-P2-2, R-P2-3). Enter lands at once; the price is fetched
// AFTER, through the /price capture path (POST /notes/{id}/facts creates a fact row and never advances
// the note: lib/blocks/blockDoors.test.js names this file as that one exception), and the stamp lands
// as its OWN, history-closed transaction after the line. Slower than STAMP_TIMEOUT_MS, a failure, or
// a deleted line: nothing is inserted. Off unless the note holds a priceStamps block with on = 'yes'.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { resolveCashtags } from '../../../../lib/tickerResolver'

export const STAMP_TIMEOUT_MS = 2000
const KEY = new PluginKey('uctPriceStamps')

export function stampsOn(doc) {
  let on = false
  doc.descendants((n) => {
    if (on) return false
    if (n.type.name === 'widgetEmbed' && n.attrs.widgetId === 'priceStamps' && n.attrs.params?.on === 'yes') on = true
    return !on
  })
  return on
}

export function lineTicker(text, noteTicker) {
  const tags = resolveCashtags(text)
  if (tags.length) return tags[0]
  const t = String(noteTicker || '').toUpperCase()
  return t && new RegExp(`(^|[^A-Za-z0-9$])${t.replace(/[.\-]/g, '\\$&')}(?![A-Za-z0-9])`).test(text) ? t : null
}

export async function requestStamp({ noteId, symbol, signal }) {
  try {
    const res = await fetch(`/api/j2/notes/${encodeURIComponent(noteId)}/facts`, {
      method: 'POST', credentials: 'include', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: symbol, factType: 'price' }),
    })
    if (!res.ok) return null
    return (await res.json())?.fact || null
  } catch {
    return null
  }
}

let seq = 0

export const PriceStamps = Extension.create({
  name: 'uctPriceStamps',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: KEY,
      state: {
        init: () => new Map(),
        apply(tr, pending) {
          const next = new Map()
          for (const [id, pos] of pending) {
            const r = tr.mapping.mapResult(pos, -1)
            if (!r.deleted) next.set(id, r.pos)
          }
          const add = tr.getMeta(KEY)
          if (add?.add) next.set(add.add.id, add.add.pos)
          if (add?.done) next.delete(add.done)
          return next
        },
      },
    })]
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor
        const { $from, empty } = state.selection
        if (!empty || !editor.isEditable || !$from.parent.isTextblock) return false
        if ($from.parentOffset !== $from.parent.content.size) return false
        const noteId = editor.storage?.uctJournalWidgets?.noteId
        if (!noteId || !stampsOn(state.doc)) return false
        const symbol = lineTicker($from.parent.textContent, editor.storage?.uctJournalWidgets?.noteTicker)
        if (!symbol) return false
        const id = `stamp-${++seq}`
        editor.view.dispatch(state.tr.setMeta(KEY, { add: { id, pos: $from.before() } }).setMeta('addToHistory', false))
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), STAMP_TIMEOUT_MS)
        requestStamp({ noteId, symbol, signal: ctl.signal }).then((fact) => {
          clearTimeout(timer)
          if (editor.isDestroyed) return
          const pos = KEY.getState(editor.state)?.get(id)
          const done = editor.state.tr.setMeta(KEY, { done: id }).setMeta('addToHistory', false)
          if (!fact?.id || pos == null || ctl.signal.aborted) { editor.view.dispatch(done); return }
          const line = editor.state.doc.nodeAt(pos)
          if (!line) { editor.view.dispatch(done); return }
          const at = pos + line.nodeSize
          const tr = closeHistory(editor.state.tr)
            .insert(at, editor.schema.nodes.financialFact.create({ factId: fact.id }))
            .setMeta(KEY, { done: id })
          editor.view.dispatch(closeHistory(tr))
        })
        return false
      },
    }
  },
})
```

(`noteTicker`: the editor page already stamps `uctJournalWidgets` with `noteId`; add `noteTicker: note.ticker` at the same place. Find it with `grep -n "uctJournalWidgets = {" app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx` and add the key beside `noteId`.)

- [ ] **Step 4: Register the extension**

In `lib/tiptap.js` `buildExtensions`, import `PriceStamps` from `'./blocks/priceStamps'` and add it to the returned array AFTER every extension that handles Enter (so its handler runs, returns `false`, and lets them and the default Enter act; V10 records the ordering rule this relies on). The module's code that runs on first open is the extension definition and the cashtag import; its allowance is 512 B (Global Constraints). If the build puts more than that in the first-open closure, keep `stampsOn`/the keyboard shortcut in `tiptap.js`'s chunk and move `requestStamp` and the insert into a `lazyLeaf`-loaded helper imported on the first stamp.

- [ ] **Step 5: `PriceStampsBlock.jsx`**

```jsx
import styles from './Blocks.module.css'

export default function PriceStampsBlock({ params, setParams, editable }) {
  const on = params.on === 'yes'
  return (
    <div className={styles.empty}>
      <button type="button" role="switch" aria-checked={on} aria-label="Stamp prices as I write"
        className={`btn btn-ghost ${styles.tap}`} disabled={!editable}
        onClick={() => setParams({ on: on ? 'no' : 'yes' })}>
        {on ? 'Price stamps: on' : 'Price stamps: off'}
      </button>
      <p className={styles.muted}>
        Write $NVDA and press Enter: the live price is added below the line a moment later, and stays as it was.
      </p>
    </div>
  )
}
```

- [ ] **Step 6: Run**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/components/notebook/blocks src/pages/command/keyListenerCensus.test.js src/pages/journal-2-0/lib/tiptap.test.js > "$TEMP/p2a-t10.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

(`tiptap.test.js`: run whichever `lib/tiptap*.test.js` files exist; `ls app/src/pages/journal-2-0/lib | grep tiptap`.) Expected: all pass; the key-listener census unchanged.

- [ ] **Step 7: Mutation-prove the async rule**

Capture `priceStamps.js`. Change `return false` at the end of the Enter handler to `return true` (the stamp would swallow Enter). "Enter lands at once" must FAIL. Restore. Change `STAMP_TIMEOUT_MS = 2000` to `20000`; "a fetch slower than the timeout inserts nothing" must FAIL. Restore by bytes; check the sha.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/lib/blocks/priceStamps.js app/src/pages/journal-2-0/lib/blocks/priceStamps.test.js app/src/pages/journal-2-0/lib/tiptap.js app/src/pages/journal-2-0/components/notebook/blocks/PriceStampsBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/PriceStampsBlock.test.jsx app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx
git commit -F - -- app/src/pages/journal-2-0/lib/blocks/priceStamps.js app/src/pages/journal-2-0/lib/blocks/priceStamps.test.js app/src/pages/journal-2-0/lib/tiptap.js app/src/pages/journal-2-0/components/notebook/blocks/PriceStampsBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/PriceStampsBlock.test.jsx app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx <<'MSG'
feat(notebook): price-stamped lines -- Enter lands at once, the stamp follows as its own undoable step, 2 s or nothing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 11: Position sizing block (the house formula only)

Spec §P2 item 5. R-P2-5, Review Focus 3 and 5.

**Files:**
- Create: `app/src/pages/journal-2-0/lib/blocks/houseSizing.js`, `houseSizing.test.js`
- Replace: `app/src/pages/journal-2-0/components/notebook/blocks/PositionSizingBlock.jsx`
- Test: `app/src/pages/journal-2-0/components/notebook/blocks/PositionSizingBlock.test.jsx`

**Interfaces:**
- Produces: `MAX_ACCOUNT_RISK_PCT = 2`; `SIZE_CEILING_PCT` (the house table, R-P2-5); `REGIME_OF = {green:'GREEN', amber:'YELLOW', orange:'ORANGE', red:'RED'}`; `houseSize({entry, stop, accountSize, grade, regime}) -> {ok, skip, reason, stopPct, sizePct, riskPct, shares, riskDollars, positionDollars, boundBy: 'regime'|'risk'}`.
- Formula (spec, verbatim): **Account Risk % = Position Size % × Stop Distance %**. Size % = min(the regime ceiling for the grade, `MAX_ACCOUNT_RISK_PCT` / Stop Distance % × 100). Shares = floor(account × Size % / entry). Risk $ = shares × |entry − stop|. No other formula.
- Consumes: `useJ2Settings()` (`settings.accountSize`), `useJ2CurrentRegime()` → `{ regime: {regime, asOf} }`.

- [ ] **Step 1: Write the failing tests**

`houseSizing.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { houseSize, SIZE_CEILING_PCT, MAX_ACCOUNT_RISK_PCT } from './houseSizing'

describe('the house table (R-P2-5, uct-intelligence api.py:2775 _SIZING_TABLE)', () => {
  it('carries every cell the spec names', () => {
    expect(SIZE_CEILING_PCT.GREEN['A+']).toBe(25)
    expect(SIZE_CEILING_PCT.YELLOW['A+']).toBe(15)
    expect(SIZE_CEILING_PCT.ORANGE['A+']).toBe(8)
    expect(SIZE_CEILING_PCT.ORANGE.B).toBe(0)
    expect(MAX_ACCOUNT_RISK_PCT).toBe(2)
  })
  it('and the engine rows the spec leaves implicit', () => {
    expect(SIZE_CEILING_PCT).toEqual({
      GREEN: { 'A+': 25, A: 20, B: 10 }, YELLOW: { 'A+': 15, A: 12, B: 6 },
      ORANGE: { 'A+': 8, A: 5, B: 0 }, RED: { 'A+': 0, A: 0, B: 0 } })
  })
})

describe('houseSize', () => {
  it('the regime ceiling binds when the stop is tight', () => {
    const r = houseSize({ entry: 100, stop: 95, accountSize: 100000, grade: 'A+', regime: 'GREEN' })
    expect(r).toMatchObject({ ok: true, stopPct: 5, sizePct: 25, riskPct: 1.25, shares: 250, riskDollars: 1250, boundBy: 'regime' })
  })
  it('the 2% cap binds when the stop is wide', () => {
    const r = houseSize({ entry: 100, stop: 90, accountSize: 100000, grade: 'A+', regime: 'GREEN' })
    expect(r).toMatchObject({ stopPct: 10, sizePct: 20, riskPct: 2, shares: 200, boundBy: 'risk' })
  })
  it('a short sizes the same way', () => {
    expect(houseSize({ entry: 50, stop: 52.5, accountSize: 10000, grade: 'A', regime: 'YELLOW' }))
      .toMatchObject({ ok: true, stopPct: 5, sizePct: 12 })
  })
  it('wrong-side, equal and skip cases size nothing and say why', () => {
    expect(houseSize({ entry: 100, stop: 100, accountSize: 1e5, grade: 'A', regime: 'GREEN' })).toMatchObject({ ok: false, reason: 'Entry and stop are the same price.' })
    expect(houseSize({ entry: 100, stop: -1, accountSize: 1e5, grade: 'A', regime: 'GREEN' })).toMatchObject({ ok: false })
    expect(houseSize({ entry: 100, stop: 95, accountSize: 1e5, grade: 'B', regime: 'ORANGE' }))
      .toMatchObject({ ok: false, skip: true, reason: 'The house rules skip a B setup in an ORANGE market.' })
    expect(houseSize({ entry: 100, stop: 95, accountSize: 1e5, grade: 'A+', regime: 'RED' })).toMatchObject({ skip: true })
  })
  it('no account size or no regime: not sized, and says what is missing', () => {
    expect(houseSize({ entry: 100, stop: 95, accountSize: null, grade: 'A', regime: 'GREEN' })).toMatchObject({ ok: false, reason: 'Set your account size in Journal settings.' })
    expect(houseSize({ entry: 100, stop: 95, accountSize: 1e5, grade: 'A', regime: null })).toMatchObject({ ok: false, reason: 'The market regime is not known yet.' })
  })
  it('never a negative or fractional share count', () => {
    const r = houseSize({ entry: 333.33, stop: 320, accountSize: 777, grade: 'A', regime: 'GREEN' })
    expect(Number.isInteger(r.shares) && r.shares >= 0).toBe(true)
  })
})
```

`PositionSizingBlock.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
let SETTINGS = { accountSize: 100000 }
vi.mock('../../../hooks/useJ2Settings', () => ({ default: () => ({ settings: SETTINGS }) }))
vi.mock('../../../hooks/useJ2CurrentRegime', () => ({ default: () => ({ regime: { regime: 'green', asOf: '2026-10-13' } }) }))
import PositionSizingBlock from './PositionSizingBlock'

describe('PositionSizingBlock', () => {
  it('named inputs; an input change is one setParams carrying the regime it was sized in', () => {
    const setParams = vi.fn(() => true)
    render(<PositionSizingBlock params={{ grade: 'A+' }} setParams={setParams} editable />)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Entry' }), { target: { value: '100' } })
    expect(setParams).toHaveBeenCalledWith({ entry: 100, regime: 'GREEN', regimeAsOf: '2026-10-13' })
  })
  it('shows size, shares and risk from the house formula', () => {
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regime: 'GREEN' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('25% of the account')).toBeTruthy()
    expect(screen.getByText('250 shares')).toBeTruthy()
    expect(screen.getByText('$1,250 at risk (1.25% of the account)')).toBeTruthy()
  })
  it('no account size: says where to set it', () => {
    SETTINGS = {}
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A', regime: 'GREEN' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Set your account size in Journal settings.')).toBeTruthy()
    SETTINGS = { accountSize: 100000 }
  })
  it('sized in an older regime: says so and offers today\'s', () => {
    const setParams = vi.fn(() => true)
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A', regime: 'ORANGE', regimeAsOf: '2026-10-01' }} setParams={setParams} editable />)
    fireEvent.click(screen.getByRole('button', { name: "Use today's regime (GREEN)" }))
    expect(setParams).toHaveBeenCalledWith({ regime: 'GREEN', regimeAsOf: '2026-10-13' })
  })
})
```

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/lib/blocks/houseSizing.test.js src/pages/journal-2-0/components/notebook/blocks/PositionSizingBlock.test.jsx > "$TEMP/p2a-t11.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL.

- [ ] **Step 3: `houseSizing.js`**

```js
// The house sizing formula, and nothing else (spec §P2 item 5):
//   Account Risk % = Position Size % × Stop Distance %
// capped at MAX_ACCOUNT_RISK_PCT, with the regime ceilings of the house table. ⛔ The table MIRRORS
// uct-intelligence/uct_intelligence/api.py:2775 `_SIZING_TABLE` (R-P2-5; quoted, with that repo's sha,
// in docs/notebook/p2-verify-before-building.md §cite). 0 = skip. houseSizing.test.js pins every cell.
export const MAX_ACCOUNT_RISK_PCT = 2
export const SIZE_CEILING_PCT = Object.freeze({
  GREEN: Object.freeze({ 'A+': 25, A: 20, B: 10 }),
  YELLOW: Object.freeze({ 'A+': 15, A: 12, B: 6 }),
  ORANGE: Object.freeze({ 'A+': 8, A: 5, B: 0 }),
  RED: Object.freeze({ 'A+': 0, A: 0, B: 0 }),
})
export const REGIME_OF = Object.freeze({ green: 'GREEN', amber: 'YELLOW', orange: 'ORANGE', red: 'RED' })

const round2 = (x) => Math.round(x * 100) / 100
const fail = (reason, extra = {}) => ({ ok: false, skip: false, reason, ...extra })

export function houseSize({ entry, stop, accountSize, grade, regime }) {
  const e = Number(entry), s = Number(stop), a = Number(accountSize)
  if (!(e > 0) || !(s > 0)) return fail('Enter an entry and a stop above zero.')
  if (e === s) return fail('Entry and stop are the same price.')
  if (!(a > 0)) return fail('Set your account size in Journal settings.')
  const row = SIZE_CEILING_PCT[regime]
  if (!row) return fail('The market regime is not known yet.')
  const ceiling = row[grade]
  if (ceiling === undefined) return fail('Pick a setup grade.')
  if (ceiling === 0) return fail(`The house rules skip a ${grade} setup in a${regime === 'ORANGE' ? 'n' : ''} ${regime} market.`, { skip: true })
  const stopPct = round2((Math.abs(e - s) / e) * 100)
  const riskCapSize = (MAX_ACCOUNT_RISK_PCT / stopPct) * 100
  const sizePct = round2(Math.min(ceiling, riskCapSize))
  const shares = Math.max(0, Math.floor((a * sizePct) / 100 / e))
  return {
    ok: true, skip: false, reason: null, stopPct, sizePct,
    riskPct: round2((sizePct * stopPct) / 100),
    shares, riskDollars: round2(shares * Math.abs(e - s)), positionDollars: round2(shares * e),
    boundBy: ceiling <= riskCapSize ? 'regime' : 'risk',
  }
}
```

- [ ] **Step 4: `PositionSizingBlock.jsx`**

```jsx
import useJ2Settings from '../../../hooks/useJ2Settings'
import useJ2CurrentRegime from '../../../hooks/useJ2CurrentRegime'
import { houseSize, REGIME_OF } from '../../../lib/blocks/houseSizing'
import styles from './Blocks.module.css'

const money = (x) => `$${Number(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

export default function PositionSizingBlock({ params, setParams, editable }) {
  const { settings } = useJ2Settings()
  const { regime: cur } = useJ2CurrentRegime()
  const today = REGIME_OF[cur?.regime] || null
  const regime = params.regime || today
  const accountSize = params.accountSize ?? settings?.accountSize ?? null
  const stamp = today ? { regime: today, regimeAsOf: cur?.asOf || '' } : {}
  const put = (key, raw) => {
    const n = raw === '' ? undefined : Number(raw)
    setParams({ [key]: Number.isFinite(n) ? n : undefined, ...(params.regime ? {} : stamp) })
  }
  const r = houseSize({ entry: params.entry, stop: params.stop, accountSize, grade: params.grade, regime })
  return (
    <div className={styles.empty}>
      <div className={styles.row}>
        <label>Entry <input type="number" inputMode="decimal" step="0.01" aria-label="Entry" disabled={!editable}
          value={params.entry ?? ''} onChange={(e) => put('entry', e.target.value)} /></label>
        <label>Stop <input type="number" inputMode="decimal" step="0.01" aria-label="Stop" disabled={!editable}
          value={params.stop ?? ''} onChange={(e) => put('stop', e.target.value)} /></label>
        <label>Grade <select aria-label="Setup grade" disabled={!editable} value={params.grade || 'A'}
          onChange={(e) => setParams({ grade: e.target.value })}>
          {['A+', 'A', 'B'].map((g) => <option key={g} value={g}>{g}</option>)}
        </select></label>
      </div>
      <p className={styles.muted}>{regime ? `Sized for a ${regime} market${params.regimeAsOf ? ` (as of ${params.regimeAsOf})` : ''}.` : 'The market regime is not known yet.'}</p>
      {editable && today && params.regime && params.regime !== today && (
        <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={() => setParams(stamp)}>
          {`Use today's regime (${today})`}
        </button>
      )}
      {r.ok ? (
        <ul aria-live="polite">
          <li>{`${r.sizePct}% of the account`}</li>
          <li>{`${r.shares} shares`}</li>
          <li>{`${money(r.riskDollars)} at risk (${r.riskPct}% of the account)`}</li>
          <li className={styles.muted}>{r.boundBy === 'risk' ? 'Capped by the 2% account-risk limit.' : `The ${regime} ceiling for an ${params.grade || 'A'} setup.`}</li>
        </ul>
      ) : (
        (params.entry != null || params.stop != null || r.skip) && <p role="status" className={styles.muted}>{r.reason}</p>
      )}
    </div>
  )
}
```

(The `PositionSizingBlock.test.jsx` "named inputs" case expects `{ entry: 100, regime: 'GREEN', regimeAsOf: '2026-10-13' }`: with no stored regime the first input stamps today's; a block that already carries one keeps it until the member presses "Use today's regime".)

- [ ] **Step 5: Run**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/components/notebook/blocks src/styles/tapFloor.test.js > "$TEMP/p2a-t11.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass.

- [ ] **Step 6: Mutation-prove the formula**

Capture `houseSizing.js`. Change `Math.min(ceiling, riskCapSize)` to `ceiling`. "the 2% cap binds when the stop is wide" must FAIL. Restore by bytes; check the sha.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/lib/blocks/houseSizing.js app/src/pages/journal-2-0/lib/blocks/houseSizing.test.js app/src/pages/journal-2-0/components/notebook/blocks/PositionSizingBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/PositionSizingBlock.test.jsx
git commit -F - -- app/src/pages/journal-2-0/lib/blocks/houseSizing.js app/src/pages/journal-2-0/lib/blocks/houseSizing.test.js app/src/pages/journal-2-0/components/notebook/blocks/PositionSizingBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/PositionSizingBlock.test.jsx <<'MSG'
feat(notebook): position sizing block -- the house formula only, regime ceilings, 2% cap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 12: Slash items and the Trade plan style v2

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx` (`ITEMS`, `TRADING_BLOCKS` `:294`)
- Modify: `api/services/journal_two/journal_styles.py` (`BUILTIN_STYLES["trade_plan"]`, `:102-105`)
- Test: `app/src/pages/journal-2-0/components/notebook/SlashMenu.blocks.test.jsx` (new), `tests/test_journal_styles_compose.py` (two cases)

**Interfaces:**
- Produces: four slash items, titles = the block labels, grouped `trading`, each `available: journalStylesEnabled`, each inserting `insertWidgetEmbed(blockId, defaults)` (`widgetEmbedNode.jsx:177`); the built-in Trade plan style at version 2 with blocks `chart`, `preEntryChecklist`, `positionSizing`, `marketContext` and placeholders after "The setup" and "Size and risk".

- [ ] **Step 1: Write the failing tests**

`SlashMenu.blocks.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
let ON = true
vi.mock('../../lib/journalStylesFlag', async (orig) => ({ ...(await orig()), journalStylesEnabled: () => ON }))
import { blockItemsAvailable, groupedSlashItems, blockItemGroup } from './SlashMenu'

const titles = ['Pre-entry checklist', 'Market context', 'Price stamps', 'Position sizing']

describe('P2a slash items', () => {
  it('each block is offered in the Trading group while the switch is on', () => {
    const here = blockItemsAvailable({})
    for (const t of titles) {
      const it_ = here.find((i) => i.title === t)
      expect(it_, t).toBeTruthy()
      expect(blockItemGroup(it_)).toBe('trading')
    }
    expect(groupedSlashItems(here, []).filter((i) => titles.includes(i.title)).every((i) => i.group === 'trading')).toBe(true)
  })
  it('none is offered while the switch is off', () => {
    ON = false
    expect(blockItemsAvailable({}).filter((i) => titles.includes(i.title))).toEqual([])
    ON = true
  })
  it('the command inserts the block kind with its catalog defaults', () => {
    const run = vi.fn()
    const chain = { focus: () => chain, deleteRange: () => chain, insertWidgetEmbed: vi.fn(() => chain), run }
    const item = blockItemsAvailable({}).find((i) => i.title === 'Price stamps')
    item.command({ editor: { chain: () => chain }, range: { from: 1, to: 2 } })
    expect(chain.insertWidgetEmbed).toHaveBeenCalledWith('priceStamps', { on: 'no' })
    expect(run).toHaveBeenCalled()
  })
})
```

In `tests/test_journal_styles_compose.py`, add:

```python
def test_trade_plan_v2_holds_the_p2a_blocks(db_path, monkeypatch):
    from api.services.journal_two import journal_styles as js, regime
    monkeypatch.setattr(regime, "_read_exposure", lambda: {"score": 95, "as_of": "2026-10-13"})
    s = js.BUILTIN_STYLES["trade_plan"]
    assert s["version"] == 2
    assert [b["block"] for b in s["blocks"]] == ["chart", "preEntryChecklist", "positionSizing", "marketContext"]
    out = js.compose("u1", js.get_style("u1", "builtin:trade_plan"), ticker="NVDA", conn=None)
    ids = [n["attrs"]["widgetId"] for n in out["bodyJson"]["content"] if n["type"] == "widgetEmbed"]
    assert ids == ["marketContext", "chart", "preEntryChecklist", "positionSizing"] or set(ids) == {"marketContext", "chart", "preEntryChecklist", "positionSizing"}
    assert out["properties"]["builtin:regime_at_write"] == "green"


def test_a_v1_trade_plan_note_is_offered_the_p2a_blocks(db_path, monkeypatch):
    from api.services.journal_two import journal_styles as js, notes
    n = notes.create_note("u1", {"title": "old", "ticker": "NVDA"}, style_stamp=("builtin:trade_plan", 1, "trade_plan"))
    plan = js.plan_style_update("u1", n["id"])
    assert (plan["fromVersion"], plan["toVersion"], plan["versionCurrent"]) == (1, 2, False)
    assert {a["block"] for a in plan["add"]} >= {"preEntryChecklist", "positionSizing", "marketContext"}
```

Fix the first test's `ids` assertion to the exact order the composer produces once Step 3 lands (placeholders place blocks in place; the unplaced go after the first heading): write the exact list, never the `or set(...)` fallback, in the committed test.

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/components/notebook/SlashMenu.blocks.test.jsx > "$TEMP/p2a-t12.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL.

- [ ] **Step 3: The slash items**

In `SlashMenu.jsx`, import `BLOCK_KINDS` from `'../../lib/journalBlocks'`; after the `Journal style` item in `ITEMS`, spread:

```js
  // Notebook P2a: each trader block in the Trading group (spec P1.4). Built from the catalog, so a
  // block's words and defaults have one home. Dark behind the switch (R-P2-1).
  ...['preEntryChecklist', 'marketContext', 'priceStamps', 'positionSizing'].map((id) => {
    const kind = BLOCK_KINDS.find((k) => k.id === id)
    return {
      title: kind.label,
      description: 'A trader block',
      keywords: ['block', 'trading'],
      available: journalStylesEnabled,
      command: ({ editor, range }) => {
        const defaults = Object.fromEntries(kind.settings.map((s) => [s.key, s.default]))
        editor.chain().focus().deleteRange(range).insertWidgetEmbed(id, defaults).run()
      },
    }
  }),
```

and add the four labels to `TRADING_BLOCKS`:

```js
const TRADING_BLOCKS = new Set(['Trade-plan canvas', 'Transcript passage', 'Journal style',
  'Pre-entry checklist', 'Market context', 'Price stamps', 'Position sizing'])
```

`journalBlocks.js` has no imports and is already in the first-open closure through `TemplatePreview`/the styles flag path (P1 Task 15 measured it); measure in Task 13 against the 1,024 B allowance.

- [ ] **Step 4: Trade plan v2**

In `journal_styles.py`, replace the `trade_plan` entry of `BUILTIN_STYLES`:

```python
    "trade_plan": {"name": "Trade plan", "version": 2, "properties": {},
                   "blocks": [_chart("D"), _blk("preEntryChecklist"), _blk("positionSizing"), _blk("marketContext")],
                   "outline": _doc(
        _h("The setup"), _p("What is the pattern, and why now?"), _ph("chart"), _ph("preEntryChecklist"),
        _h("Entry, stop and target"), _p("Entry:"), _p("Stop:"), _p("Target:"),
        _h("Size and risk"), _ph("positionSizing"), _p("How much am I risking, and is it within my rules?"))},
```

and beside `_chart`:

```python
def _blk(block: str) -> dict:
    """A trader block with its catalog defaults (P2)."""
    kind = _BLOCK_BY_ID[block]
    return {"block": block, "enabled": True, "settings": {s["key"]: s["default"] for s in kind["settings"]}}
```

The version bump is what offers "Update layout to v2" to every Trade plan note made from v1 (the comment above `BUILTIN_STYLES`: "Versions are bumped BY HAND when an outline here changes").

- [ ] **Step 5: Run**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npx vitest run src/pages/journal-2-0/components/notebook/SlashMenu.blocks.test.jsx src/pages/journal-2-0/components/notebook/SlashMenu.test.jsx src/pages/journal-2-0/components/notebook/styles src/pages/journal-2-0/lib/journalStyles.test.js > "$TEMP/p2a-t12.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/notebook_contract_fixtures.py > "$TEMP/p2a-t12-gen.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_journal_styles_compose.py tests/test_journal_styles_store.py tests/test_journal_styles_update.py tests/test_journal_styles_create.py tests/test_notebook_contract_fixtures.py -q > "$TEMP/p2a-t12-py.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass. A fixture that recorded the Trade plan at version 1 changes; read every changed fixture's diff and confirm each change is the version or the new blocks, then re-run P1's client tests that pin those fixtures (`StylesManager.test.jsx`, `journalStyles.test.js`).

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx app/src/pages/journal-2-0/components/notebook/SlashMenu.blocks.test.jsx api/services/journal_two/journal_styles.py tests/test_journal_styles_compose.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract
git commit -F - -- app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx app/src/pages/journal-2-0/components/notebook/SlashMenu.blocks.test.jsx api/services/journal_two/journal_styles.py tests/test_journal_styles_compose.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract <<'MSG'
feat(notebook): trader blocks in the slash menu's Trading group; Trade plan style v2 holds them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 13: Walk steps at 1280/820/390, the integrity step, door rows, bytes, typing

**Files:**
- Modify: `tools/notebook_fin_walk_features.py` (`ORDER` `:35`, a `blocks()` step registered before `discover`)
- Modify: `tools/notebook_door_audit_doors.json` (rows 57-60; row 56 per V1)
- Modify: `tools/notebook_perf_harness.py` (`--with-blocks`)
- Create: `docs/notebook/evidence/fin-walk/<tip>/c2/`, `docs/notebook/evidence/door-audit-<stamp>/`, `docs/notebook/perf-runs/p2a/`

**Interfaces:**
- Produces walk features `blocks.slash-insert` (1280/820/390), `blocks.integrity-tick-leave`, `blocks.price-stamp`, `blocks.sizing`, `blocks.market-context`, `blocks.log-trade-checklist`, `blocks.switch-off-renders`, `blocks.coverage`.

- [ ] **Step 1: The walk step**

In `run_c2`, before `run("discover", discover)`, add a `blocks()` step built from the `styles()` idioms (`C.goto`, `C.vis_loc`, `C.step`, `C.notes_list`, `M`, the per-viewport `at(vp)` contexts) and the `save_landed` waiter Task 2 added. What each row does and asserts:

```python
    # ── Notebook P2a: trader blocks, at 1280 / 820 / 390 ────────────────────────────────────
    def blocks():
        # blocks.slash-insert (each viewport): new note, type "/Pre-entry checklist", Enter; the group
        #   "Pre-entry checklist" appears; at 820/390 its first control's box is >= 44 px tall.
        # blocks.integrity-tick-leave (1280): written out in full just below this comment block.
        # blocks.price-stamp (1280): a note with a Price stamps block, switch turned on through the block's
        #   own switch; type "Long $NVDA" and Enter; wait (locator.wait_for, 10 s) for the fact card V9
        #   recorded; assert one financialFact follows the line and Ctrl+Z removes it alone.
        #   In the sandbox the price capture may answer an error (no vendor): then assert NOTHING was
        #   inserted within 3 s of the Enter and record verdict INFO with the answer's status, never FAIL.
        # blocks.sizing (1280): entry 100, stop 95, grade A+ in a GREEN sandbox regime (or whatever
        #   /api/j2/regime answers; record it) ; assert the size line matches houseSize's answer for the
        #   regime the block shows.
        # blocks.market-context (1280): insert by slash, press "Capture now"; assert "Captured" appears
        #   and the body's params.snapshot.fields has six keys.
        # blocks.log-trade-checklist (1280 and 390): set the preference on through the Settings checkbox,
        #   open Log Trade -> Log open position, pick VCP; the group "Pre-entry checklist" shows; tick one,
        #   submit; assert GET /api/j2/trader-blocks/... is not needed: read the adherence store through
        #   the closed-trade read after closing the position (POST /api/j2/positions/{id}/close), and
        #   assert checkedRuleIds == ["s1"].
        # blocks.switch-off-renders (1280): restart is not possible mid-walk, so this row reads a note
        #   holding all four blocks through a second member context whose auth payload is patched to
        #   notebook_journal_styles_enabled=false by route interception of /api/auth/me; assert each block's
        #   group renders and no slash item for a block is offered.
        # blocks.coverage: every feature above left a row.

        # ── blocks.integrity-tick-leave (1280): spec §P2's P0.0 repro shape, written out ─────────
        listing = M.get(base + "/api/j2/accounts").json()        # shape per V13
        acct_id = (listing.get("accounts") if isinstance(listing, dict) else listing)[0]["id"]
        st = M.get(base + f"/api/j2/accounts/{acct_id}/settings").json()
        st.update({"setups": ["VCP"], "setupRules": {"VCP": [{"id": "s1", "label": "Volume dry-up"}]}})
        M.put(base + f"/api/j2/accounts/{acct_id}/settings", data=st)
        body = {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "tick and leave"}]},
            {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "preEntryChecklist", "embedId": "walk-ck-1",
             "mode": "snapshot", "params": {"setup": "VCP", "includeRules": "no", "requireAll": "no", "checked": []},
             "searchText": "[pre-entry checklist]"}}]}
        note = M.post(base + "/api/j2/notes", data={"title": "Tick and leave", "bodyJson": body}).json()["note"]
        C.goto(pg, base, f"/journal/notebook?note={note['id']}", wait=".ProseMirror")
        box = pg.get_by_role("checkbox", name="Volume dry-up")
        C.vis_loc(box, 15000)
        box.check()
        t_tick = time.monotonic()
        # An in-app navigation (the router hears popstate), started at once: the member leaving the note.
        pg.evaluate("() => { history.pushState({}, '', '/journal/notebook?view=all');"
                    " window.dispatchEvent(new PopStateEvent('popstate')) }")
        left_ms = round((time.monotonic() - t_tick) * 1000)      # when the navigation was STARTED
        pg.locator("main").first.wait_for(state="visible", timeout=15000)
        landed = save_landed(pg, note["id"], note["updatedAt"])
        ticked = bool(landed) and any(
            (x.get("attrs") or {}).get("params", {}).get("checked") == ["s1"]
            for x in landed["bodyJson"]["content"] if x.get("type") == "widgetEmbed")
        conflicted = [x for x in C.notes_list(ctx, base) if "(conflicted copy)" in (x.get("title") or "")]
        ok = left_ms <= 1500 and ticked and not conflicted
        C.step(pg, inst, "blocks.integrity-tick-leave",
               "Tick a checklist item and leave within 1.5 s: the tick lands through autosave, no conflicted copy",
               "PASS" if ok else "FAIL", left_ms=left_ms, saved=bool(landed), ticked=ticked, conflicted=len(conflicted))
        # ... the other rows, then blocks.coverage ...
    run("blocks", blocks)
```

Write each remaining row in full in the tool, in the order listed, with waiters only (`wait_for`, `vis_loc`, `save_landed`; no bare `wait_for_timeout`), and add `"blocks"` to `ORDER` before `"discover"`. `left_ms` measures the START of navigation, which is what the spec's "navigates away within 1.5 s" means; a slow page load after that is not the member's delay. Extend `tests/test_notebook_fin_walk_styles_step.py` with `test_the_blocks_step_has_no_blind_sleep` (the same AST read, on `def blocks`).

- [ ] **Step 2: Door rows**

Append to `tools/notebook_door_audit_doors.json` (edit as text; keep its formatting):

```json
  {
    "feature": "Trader blocks in the slash menu (P2a)",
    "audit_row": 57,
    "path": "/journal/notebook",
    "steps": [{"click": "link|View all notes"}, {"click": "button|+ New note"}, {"type": "/Pre-entry"}],
    "target": {"role": "option", "name": "Pre-entry checklist"},
    "viewports": ["1280", "390"],
    "flag": "NOTEBOOK_JOURNAL_STYLES_ENABLED",
    "note": "Each P2a block is one slash item in the Trading group; the checklist stands for the four."
  },
  {
    "feature": "Pre-entry checklist in Log Trade (P2a)",
    "audit_row": 58,
    "path": "/journal",
    "steps": [{"click": "button|Log Trade"}, {"click": "menuitem|Log open position"}],
    "target": {"role": "group", "name": "Pre-entry checklist"},
    "viewports": ["1280", "390"],
    "flag": "NOTEBOOK_JOURNAL_STYLES_ENABLED",
    "note": "Shown only with the member's opt-in; the audit member turns it on first (Settings)."
  },
  {
    "feature": "Log Trade checklist opt-in (P2a)",
    "audit_row": 59,
    "path": "/journal",
    "steps": [{"click": "button|Settings"}],
    "target": {"role": "checkbox", "name": "Show my pre-entry checklist in Log Trade"},
    "viewports": ["1280", "390"],
    "flag": "NOTEBOOK_JOURNAL_STYLES_ENABLED",
    "note": "In the Journal settings' setups section."
  },
  {
    "feature": "Update layout offers the P2a blocks (P2a)",
    "audit_row": 60,
    "path": "/journal/notebook",
    "steps": [{"open_seeded_note": "trade_plan_v1"}],
    "target": {"role": "button", "name": "Review update"},
    "viewports": ["1280", "390"],
    "flag": "NOTEBOOK_JOURNAL_STYLES_ENABLED",
    "note": "A Trade plan note made from v1 is offered v2."
  }
```

Before writing these, read `tools/notebook_door_audit.py` for the step verbs it understands (`click`, and the seeds `SEEDS = ("find_similar",)` P1 recorded at `:120`). A step verb the audit does not know (`type`, `open_seeded_note`) is NOT added: a row that needs one is instead measured by its walk row (`blocks.slash-insert`, the styles update row), and the door JSON carries only the rows the audit can drive. Write in the PR body which of 57-60 are audit rows and which are walk-measured. Row 56 (the list caret) is measured here only if V1 found the caret on the base.

- [ ] **Step 3: Pure rails**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python -m pytest tests/test_notebook_door_audit.py tests/test_notebook_fin_walk_styles_step.py -q > "$TEMP/p2a-t13-rails.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/notebook_door_audit.py --self-check > "$TEMP/p2a-t13-selfcheck.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: pass; self-check exit 0.

- [ ] **Step 4: Build and bytes**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2/app
npm run build > "$TEMP/p2a-build.log" 2>&1; code=$?; echo "BUILD EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/notebook_perf_budgets.py --dist app/dist --json docs/notebook/perf-runs/p2a/bytes-after.json > "$TEMP/p2a-bytes.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Compare with V3's base JSON (copy it to `docs/notebook/perf-runs/p2a/bytes-before.json`; both JSONs are committed, closing ledger R24 M8). Expected: exit 0, and after − before ≤ 3,072 B, with each task within its allowance by the chunk list. A larger delta names the module from the chunk list and moves it lazy before landing.

- [ ] **Step 5: Typing re-measure (spec §6)**

Add `--with-blocks` to `tools/notebook_perf_harness.py`: a flag that makes `_seed` insert, as the doc's SECOND node, one `widgetEmbed` of every trader block kind (attrs exactly as the server builders shape them: `v`, `widgetId`, `embedId`, `mode: "snapshot"`, `params` from the catalog defaults, `searchText`), and a `--self-check`/`--dry-run` case asserting the seeded doc carries all four. Then, from the PowerShell tool on a quiet box (no gate, no other harness; print available memory first):

```powershell
python tools/notebook_perf_harness.py --boot --busy --sizes <V2's sizes> --opens 20 --chars 60 --json docs/notebook/perf-runs/p2a/plain.json --md docs/notebook/perf-runs/p2a/plain.md
python tools/notebook_perf_harness.py --boot --busy --with-blocks --sizes <V2's sizes> --opens 20 --chars 60 --json docs/notebook/perf-runs/p2a/blocks.json --md docs/notebook/perf-runs/p2a/blocks.md
```

Commit the raw JSON and logs BEFORE writing any comparison (R-RAW). Then compare `typing_busy_per_char` p95 at each size against V2's baseline of record. Expected: no regression beyond the instrument's own run-to-run spread recorded in `docs/notebook/perf-budgets.md` (state the spread used). A regression is a defect to fix before landing, never a line moved.

- [ ] **Step 6: Sandbox walk c2 and door audit (PowerShell for the data dir)**

```powershell
python tools/notebook_fin_walk.py --config c2 --data-root 'C:\Users\Patrick\AppData\Local\Temp\nb-p2a-walk' --port 8133 --out 'C:\Users\Patrick\uct-worktrees\notebook-p2\docs\notebook\evidence\fin-walk\<tip>\c2' --tip <tip>
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/notebook_door_audit.py --base http://127.0.0.1:8133 --doors tools/notebook_door_audit_doors.json --out docs/notebook/evidence
```

Expected: 0 FAIL in the walk (the styles rows from Task 2 included, which is ledger R24's re-walk), and every new audit row EASY or OK at 1280 and 390, none HIDDEN. Diff verdicts against the latest committed c2 record (P1's `docs/notebook/evidence/fin-walk/9ef039da76-r2/c2/walk.json`); a row that passed there and fails now is a regression to fix.

- [ ] **Step 7: Commit the tool changes and evidence**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
python tools/check_repo_hygiene.py
git add tools/notebook_fin_walk_features.py tools/notebook_door_audit_doors.json tools/notebook_perf_harness.py tests/test_notebook_fin_walk_styles_step.py docs/notebook/evidence docs/notebook/perf-runs/p2a
git commit -F - -- tools/notebook_fin_walk_features.py tools/notebook_door_audit_doors.json tools/notebook_perf_harness.py tests/test_notebook_fin_walk_styles_step.py docs/notebook/evidence docs/notebook/perf-runs/p2a <<'MSG'
test(notebook): P2a walk steps (1280/820/390, tick-and-leave integrity), door rows, bytes and typing evidence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 14: Exit bar — six-shard gate from a gate worktree, Python rails on the landing tree, PR

- [ ] **Step 1: A gate worktree with a `notebook-*` branch name** (a gate never shares a tree with an implementer)

```bash
SHA=$(git -C /c/Users/Patrick/uct-worktrees/notebook-p2 rev-parse HEAD)
git -C /c/Users/Patrick/uct-worktrees/notebook-p2 worktree add -b notebook-p2-gate /c/Users/Patrick/uct-worktrees/notebook-p2-gate "$SHA"
printf 'session: <this session id>\ncreated: <YYYY-MM-DD>\n' > /c/Users/Patrick/uct-worktrees/notebook-p2-gate/.uct-session-owner
```

```powershell
New-Item -ItemType Junction -Path C:\Users\Patrick\uct-worktrees\notebook-p2-gate\app\node_modules -Target C:\Users\Patrick\uct-worktrees\notebook-k\app\node_modules
Get-Item C:\Users\Patrick\uct-worktrees\notebook-p2-gate\app\node_modules -Force | Select-Object LinkType, Target
```

- [ ] **Step 2: Print available memory; then gate**

```powershell
(Get-Counter '\Memory\Available MBytes').CounterSamples.CookedValue
```

Expected: ≥ 8,000 MB and no other gate running. Otherwise wait.

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2-gate
python scripts/gate_shards.py --shards 6 --out docs/notebook/gate-runs/p2a-landing > "$TEMP/p2a-gate.log" 2>&1; code=$?; echo "GATE EXIT: $code"; exit $code
```

Read the manifest under `docs/notebook/gate-runs/p2a-landing/`: the totals line, the file-count reconciliation and `GATE EXIT`. An `INVALID-*.md` is the environment, never a verdict. Classify any NEW failure by running it alone on the branch and on the base.

- [ ] **Step 3: Python rails on the landing tree** (C4-python: this branch touches `api/`, `tools/`, `tests/`, `scripts/`)

Merge `origin/master` into the branch first if it moved (one merge, no rebase). Then, on that tree:

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p2
PYTHONIOENCODING=utf-8 python -m pytest tests/test_trader_blocks.py tests/test_trader_blocks_pre_entry.py tests/test_trader_blocks_no_note_door.py tests/test_regime_at_write.py tests/test_notebook_fin_walk_styles_step.py tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_create.py tests/test_journal_styles_update.py tests/test_notebook_journal_styles_router.py tests/test_notebook_contract_fixtures.py tests/test_note_kind_property.py tests/test_journal_two_properties_router.py tests/test_journal_two_notes_versions_router.py tests/test_journal_two_note_templates_router.py tests/test_notebook_template_gallery.py tests/test_notebook_schema_guard.py tests/test_notes_cas_is_atomic.py tests/test_notes_answer_is_the_committed_row.py tests/test_notebook_door_audit.py tests/test_notebook_flags.py tests/test_address_space.py tests/test_account_deletion_manifest.py tests/test_gate_shards.py tests/test_user_definitions_auth.py tests/test_paywall_gate_free_tier.py -q > "$TEMP/p2a-py-landing.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

(Add the adherence router test file and the preferences test file Tasks 5 and 8 named.) Then `python tools/gate_carry_over.py --help`, and run the carry-over check as it prints, against the gated tree and the landing tree. UNKNOWN is never a pass; a C1-C3 failure means re-gate.

- [ ] **Step 4: PR body and report**

Open the PR from `notebook-p2-blocks` (one master merge at a time; `web` SUCCESS before any other push). The body says:
- what shipped, and that it ships DARK behind `NOTEBOOK_JOURNAL_STYLES_ENABLED` (R-P2-1: no new flag);
- the seven rulings R-P2-1 to R-P2-7, each with its cost if wrong;
- the integrity rule and its three rails (`blockDoors.test.js`, `test_trader_blocks_no_note_door.py`, the unchanged door census), and the walk's tick-and-leave row;
- bytes before, after and per-task delta against the allowances;
- the typing comparison and the baseline of record (V2);
- the walk and door-audit numbers, and which ledger items closed (R24 M2-M6, M8; R28 N1/N2 or "owed with the caret");
- that part b carries items 2, 6, 7, rule versions, the insight, M-7 and NVDA, and that arming waits for part b.

The body ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
```

After merge, verify the deploy by its artifact: the deploy record's commit and `SUCCESS`, uptime ≥ 730 s, `python tools/hub_nav_smoke.py --auth`, and `git merge-base --is-ancestor <merge sha> origin/production`. H15: a failing smoke means roll back first; INCONCLUSIVE is not FAILED.

- [ ] **Step 5: Clean up this session's worktrees** (only those whose `.uct-session-owner` names this session)

```powershell
cmd /c rmdir C:\Users\Patrick\uct-worktrees\notebook-p2-gate\app\node_modules
```

```bash
git -C /c/Users/Patrick/uct-worktrees/notebook-p2 worktree remove /c/Users/Patrick/uct-worktrees/notebook-p2-gate
```

Keep `notebook-p2` for part b.

---

## Self-review (done at write time)

**Spec coverage (part a's share):**
- §P2 preamble, per-block contract: registry entry and settings schema → Tasks 3 and 6; empty states → Tasks 7, 9, 11 (and `BlockEmpty`); error state that never blanks the note → Task 6 (`BlockBoundary`, `BLOCK_ERROR_SENTENCE`); phone layout, keyboard path, accessible names → `Blocks.module.css` 44 px rows at ≤1024, native controls with names in every block test; a walk step → Task 13; "needs X, not on for you" → `BlockNeedsSwitch` (Task 6), used by the market context capture (Task 9). The other P2a blocks need no other switch.
- Integrity rule → Global Constraints, Task 6 (`useBlockParams`, `blockDoors.test.js`), Task 5 (`test_trader_blocks_no_note_door.py`), Task 13 (tick-and-leave).
- Item 1 → Tasks 7 and 8 (Log Trade, opt-in, soft warning, adherence carry, R-P2-7). "Review drafts" read the carried ticks in part b's review pack.
- Item 3 → Tasks 3, 4, 9 (`builtin:regime_at_write`, the board door per V8).
- Item 4 → Task 10 (async, 2 s, own transaction, off by default, the `/price` path and `financialFact`).
- Item 5 → Task 11 (house formula only).
- Composer and P1 wiring → Tasks 3 (catalog + builders) and 12 (Trade plan v2). Daily prep and Review styles → part b Task 11.
- §6: lazy chunks and bytes → Tasks 6, 10, 12, 13; typing → Task 13; contract fixtures → Tasks 3, 5, 12; ONE-FACT rails → Task 3 (catalog incl. `search`), Task 11 (house table); walk at 1280/820/390 → Task 13; door rows → Task 13; NVDA → part b Task 14.
- P1 absorbs: R24 M2-M6 → Task 2 (re-walked in 13), M8 → Task 13 Step 4; R28 N1/N2 → Task 2 (per V1); row 56 and rows 54/55 re-measured → Task 13 (per V1); M-7 → part b Task 4.

**Placeholders:** the remaining look-ups are written as explicit commands with a stated consequence (V1-V13 in Task 1; the file names Tasks 4, 5 and 8 confirm with `grep`/`ls` before running). Two test bodies are described by their exact assertions rather than code, because they must use a file's existing render helper: `WidgetEmbedView.unknownKind.test.jsx`'s dispatcher case (Task 6 Step 8) and the four modal cases (Task 8 Step 1). Task 13's walk rows are specified row by row with what each asserts and how it waits.

**Type consistency:** `setParams(patch) -> boolean` (Task 6) is what Tasks 7, 9, 10's block, 11 call. `checklistItems/uncheckedItems/checklistSummary` (Task 7) are what Task 8 imports. `market_context_snapshot()` shape (Task 3) is what `fieldLines` (Task 9) reads and `_captured_regime` (Task 4) reads (`params.snapshot.fields.regime.value`). Block ids are identical in `BLOCK_KINDS` (both files), the registry manifests, `BLOCK_COMPONENTS`, `trader_blocks.BUILDERS` and the slash items. `HOUSE_REGIME` (server) and `REGIME_OF` (client) map the same four ids to the same four words.

**Review Focus:** each of the five lines names its owning test, written in Tasks 4, 6, 7, 10 and 11.
