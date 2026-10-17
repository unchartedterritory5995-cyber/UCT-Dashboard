# P2 Tier 3: verify before building (V1-V12)

**HEADROOM OK.** First-open closure 2,235,797 B against a budget of 2,260,793 B leaves **24,996 B** of headroom; the plan needs 700 B.

Run id `20261017T153803Z`. Raw outputs: `docs/notebook/evidence/t3-verify-20261017T153803Z/` (written before this document). Plan: `docs/superpowers/plans/2026-10-17-notebook-p2-tier3.md` Task 1. `J` = `app/src/pages/journal-2-0`, `S` = `api/services/journal_two`. Every line below was read in this worktree at the base in V1; nothing here was changed.

## Step 1: the worktree

Read-only verification, `evidence/.../step1-worktree-verify.txt`.

- Worktree `C:\Users\Patrick\uct-worktrees\notebook-t3`, branch `notebook-t3`, pushed (`origin/notebook-t3` = `5626a6462c`).
- `.uct-session-owner` present: `session: 61625d99-f8db-4269-a728-231c08d3da11`, `created: 2026-10-17`.
- Shared install `_nb-shared-install/node_modules`: 377 entries. `app/node_modules` is a junction (`Get-Item -Force`: LinkType `Junction`, Target `...\_nb-shared-install\node_modules`), 377 entries through it.
- `9b0a52d296` and `5626a6462c` are both ancestors of HEAD. `5626a6462c` is the merge of `origin/notebook-lazy-screenshot` (PR #373) into `9b0a52d296` (parents `9b0a52d296`, `1b10fd0a7e`).
- No `git worktree add`, no `npm install`, no `npm ci`, junction and shared install untouched.

## Step 2: base reds

Every file was run in its own call. Totals are in `evidence/.../results-index.txt`; each log is beside it. No run is without a totals line.

**Vitest, 38 files, all green** (registry 43, reachable 17, tapFloor 5, blockDoors 21, `traderBlocks.a11y` 3, the 11 `blocks/*.test.jsx`, the 4 `SlashMenu*.test.jsx`, the 13 `insights/*.test.jsx`).

**Pytest, 13 files, 12 green and 1 red:**

| File | Result |
|---|---|
| `test_journal_styles_store.py` | 26 passed |
| `test_trader_blocks.py` | 23 passed |
| `test_trader_blocks_market_context.py` | 70 passed |
| `test_trader_blocks_no_note_door.py` | 7 passed |
| `test_trader_blocks_pre_entry.py` | 29 passed |
| `test_trader_blocks_prep.py` | 41 passed |
| `test_trader_blocks_price_stamp.py` | 39 passed |
| `test_trader_blocks_review.py` | 12 passed |
| `test_public_note_payload.py` | 391 passed |
| `test_notebook_flags.py` | 61 passed |
| `test_notebook_flag_parse.py` | **2 failed**, 279 passed |
| `test_notebook_sample_size.py` | 24 passed |
| `test_journal_two_account_purge.py` | 7 passed |

The two reds are `test_NO_notebook_flag_is_read_outside_the_one_parse` and `test_every_flag_on_call_names_a_payload_flag`. Both are **on the known base list** (`test_notebook_flag_parse.py: 2`). Their scan reads `tools/runtime_pane_smoke.py:234,236` (`VITE_PINE_RUNTIME_PANE_ENABLED`), which is not Notebook code.

Not run, because they are not in the Step 2 list: `keyListenerCensus`, `test_notebook_switch_rehearsal.py`, `test_feature_status.py`, `test_user_definitions_auth.py`, `test_address_space.py`. No red outside the known list was seen.

The glob `tests/test_journal_two_analytics*.py` matches nothing (see Differs D12). The account purge test is `tests/test_journal_two_account_purge.py`.

## Step 3: V1 to V12

### V1: base SHA

`git rev-parse HEAD` = `5626a6462cf0d73f12e7cd6a25f6c41c457fd356` (branch `notebook-t3`). It is `origin/master` `9b0a52d296` plus the PR #373 merge. `git ls-remote origin master` now answers `51482ceac2`, so master has moved since (not merged here).

### V2: `blockManifest`, the block entries, S20

`app/src/widgets/registry.js:291`:
`function blockManifest(label, paramsSchema, line) {` returns `labels`, `defaults: { w: 6, h: 4, minW: 3, minH: 2 }`, `captureOnly: true`, `block: true`, `themeFollow: true`, `paramsSchema`, `plainText: () => line`, `reconstructable: false`, `liveCapable: false` (lines 291-305).

Block entries `registry.js:877-913`, `preEntryChecklist` at 877 ... `tradeReview` at 910:
`tradeReview: blockManifest('Post-trade review', [ { key: 'tradeId', type: 'string' }, ], '[post-trade review]'),`

S20, `app/src/widgets/registry.test.js`:
- `:691` `it('S20: a block\'s plain text IS its catalog search line'` ... `expect(paramsPlainText(id, {}), id).toBe(blockSearch(id))`
- `:698` `it('S20: the registry\'s enum options and defaults ARE the catalog\'s, for every catalog setting of a block'`. Its body (`:704-706`): `if (kind.settings.length === 0) { expect(WIDGET_REGISTRY[id].paramsSchema.filter(x => x.type === 'enum'), `${id} enums`).toEqual([]) }`.
- `BLOCK_IDS` is typed by hand at `:60-61`, and `IDS` at `:44-57`. `:654` asserts `expect(blocks).toEqual(BLOCK_IDS)`.

### V3: `BLOCK_KINDS` both sides and the Node rail

- Client `J/lib/journalBlocks.js:8`: `export const BLOCK_KINDS = Object.freeze([`. 12 kinds: chart, preEntryChecklist, priceStamps, positionSizing, myRules, prepWire, prepEarnings, prepMovers, prepLevels, tradeReview, marketcontext, reminder. The tail row is `:56` `Object.freeze({ id: 'tradeReview', label: 'Post-trade review', search: '[post-trade review]', settings: Object.freeze([]) }),`.
- Server `S/journal_styles.py:53` `BLOCK_KINDS: tuple[dict, ...] = (`; `:71` `{"id": "tradeReview", "search": "[post-trade review]", "settings": ()},`; `:79` `KNOWN_BLOCKS = frozenset(k["id"] for k in BLOCK_KINDS)`; `:80` `_BLOCK_BY_ID = ...`.
- Node rail `tests/test_journal_styles_store.py:31` `def _client_blocks():` (imports the client module through `node --input-type=module`) and `:41` `def test_the_client_block_catalog_equals_the_server_catalog():` asserting `shape(client) == shape(js.BLOCK_KINDS)` over `(id, search, [(key, options, default)])`.
- Where the style editor lists kinds: `J/components/notebook/styles/StyleEditor.jsx:153` `const addable = BLOCK_KINDS.filter((k) => !blocks.some((b) => b.block === k.id))` (rendered at `:300`). `:23` `KNOWN` and `KindSection.jsx:23` `KNOWN_BLOCKS` are label lookups, not offer lists.
- Builders: `S/journal_styles.py:703-707` `BLOCK_BUILDERS = {"chart": _build_chart, _rb.BLOCK_ID: _rb.build_reminder, **_tb.BUILDERS}`.

### V4: `trader_blocks`

`S/trader_blocks.py`:
- `:23-24` `BLOCK_IDS = ("preEntryChecklist", "priceStamps", "positionSizing", "myRules", "prepWire", "prepEarnings", "prepMovers", "prepLevels", "tradeReview")`
- `:82` `def _node(block_id: str, params: dict, ctx: dict) -> dict:` builds a `widgetEmbed` with `"searchText": js._BLOCK_BY_ID[block_id]["search"]`.
- `:136` `BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]] = {` (three part-a builders).
- `:143` `def _empty(block_id: str, params: dict | None = None):` returns a builder producing `_node(block_id, dict(params or {}), ctx), None`.
- `:158-161` `BUILDERS.update({"myRules": build_my_rules, "tradeReview": _empty("tradeReview", {"tradeId": ""}),})`.
- `:562` `BUILDERS["marketcontext"] = build_market_context`; `:902` the four prep builders.

### V5: slash menu

`J/components/notebook/SlashMenu.jsx`:
- `:36-44` `const traderItem = (id, more) => ({ title: WIDGET_REGISTRY[id].labels.menu, description: 'A trader block', keywords: ['block', 'trading'], available: journalStylesEnabled, trading: true, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertWidgetEmbed(id).run(), ...more, })`
- `:302-312` the `traderItem(...)` calls, `preEntryChecklist` at 302, `tradeReview` at 312; `:313` `traderItem('marketcontext', {` follows.
- `:349` `const TRADING_BLOCKS = new Set(['Trade-plan canvas', 'Transcript passage', 'Journal style'])`; `:352-355` `export function blockItemGroup(item) { if (item.trading || TRADING_BLOCKS.has(item.title)) return 'trading'`.

### V6: vendor row in the public payload

`S/public_note_payload.py:171` `MARKET_DATA_VENDORS: dict[tuple[str, str | None], str] = {`; `:203` `("widgetEmbed", "preEntryChecklist"): "private",` ... `:213` `("widgetEmbed", "tradeReview"): "private",`.
Rail `tests/test_public_note_payload.py:663-664`: `@pytest.mark.parametrize("widget_id", widget_ids())` / `def test_every_registered_widget_has_a_vendor_row(widget_id):` asserting `("widgetEmbed", widget_id) in pnp.MARKET_DATA_VENDORS`. `widget_ids()` (`:89`) is read from the client registry, so a new registry id with no row fails by name.

### V7: sidecar walk, trash, restore, purge

- `S/notes.py:357` `def _sync_note_sidecars(conn, user_id, note_id, body_json, body_plain) -> None:`; the one walk is `:371-421`. The `widgetEmbed` branch is `:379-406`: `attrs = node.get("attrs")`, `params = attrs.get("params")`, `widget_id = attrs.get("widgetId")`, appends `{"widget_id", "symbol", "timeframe", "trade_ref", "trade_ref_type", "mode", "captured_at"}`. The embed rows are rebuilt at `:437-446` with `DELETE FROM j2_note_embeds WHERE note_id = ?` then `executemany`. `j2_note_mentions` is rebuilt by `_sync_note_mentions` (`:344` `conn.execute("DELETE FROM j2_note_mentions WHERE note_id = ?", (note_id,))`), called at `:452`. The function ends at `:505`.
- **Trash does not touch any sidecar.** `delete_note` (`:4204`) docstring: `the row, its embeds, and its FTS index entry are left physically intact`; its only write is `UPDATE j2_notes SET deleted_at = ? ...` (`:4220`).
- **Restore rebuilds nothing.** `restore_note` (`:4240`) only runs `UPDATE j2_notes SET deleted_at = NULL, updated_at = ?` (`:4256`). Sidecars are filtered at read time by `deleted_at IS NULL`.
- **Hard delete.** `purge_expired_deleted_notes` (`:4341`) deletes the two by hand: `:4369` `conn.execute("DELETE FROM j2_note_embeds WHERE note_id = ?", (note_id,))`, `:4370` `conn.execute("DELETE FROM j2_note_mentions WHERE note_id = ?", (note_id,))`. These two have no trigger. Links, fact refs, versions, favourites, recents and the task digest are cleaned by `AFTER DELETE ON j2_notes` triggers (`db.py:36, 640, 643, 674, 888, 1023`). That is the only hard-delete path for notes (grep of `DELETE FROM j2_notes`: `notes.py:4368` and the account purge).
- Other rebuild points: `_sync_note_sidecars` is called from `notes.py:1315, 1336, 3343, 3848, 3938, 4004, 4071` (create, import, update, version restore, and the rest).
- Account purge: `S/account_purge.py:32` `_DIRECT_USER_TABLES = (`, with `:56` `"j2_note_embeds",` and `:57` `"j2_note_mentions",`. `tests/test_account_deletion_manifest.py` compares that list to `docs/account-deletion-manifest.md`.
- Sidecar DDL precedent: `S/db.py:812-826` `CREATE TABLE IF NOT EXISTS j2_note_embeds (... PRIMARY KEY (note_id, position))`, no foreign key.

### V8: `_psychology_section` and its call site

- `S/analytics.py:1021-1024`: `def _psychology_section(rows: list[sqlite3.Row], suppressed_pairs: frozenset[str] | set[str] = frozenset(),) -> dict[str, Any]:`.
- Call site `:171` `"psychology": _psychology_section(rows),`, inside `get_analytics(user_id, *, account_id=None, date_from=None, date_to=None, spec=None, conn=None)` (`:89`). `user_id` is the first parameter and `conn` is bound at `:110` `conn = conn or get_connection()`; both are in scope at `:171`. `spec` (with `spec.date_from` / `spec.date_to`) is in scope too.
- `rows` come from `_fetch_trades` (`:186-222`): `... trading_day_et, hour_et, id, external_id, source, mistake_tags, emotion_tags, fees FROM j2_trades WHERE user_id = ? ` + `ANALYTICS_INCLUDED_SQL`. `trading_day_et` is selected, so the R-T3-3 join key is already on each row.
- Tag parsing precedent: the section builds `"emotionTags": _json_tags(r["emotion_tags"])`; `winRate` is `wins / (wins + losses)` with `None` when no decisive trade; `avgPnl` is the mean of `pnlDollarNet`.

### V9: `MakeRuleButton` and the rules create call

`J/components/insights/MakeRuleButton.jsx`:
- `:59` `export default function MakeRuleButton({ mistake, count, total, accountId, onCreated }) {`. The label is derived inside from `RULE_LABELS[mistake]` (`:29`, `:49-51`); the evidence is `:77` ``const evidence = `${mistake} tagged ${count}× · ${money(total)} lifetime` ``. Neither is a prop.
- `:90-95` `const res = await create({ label: text, evidence, sourceType: 'psychology', sourceId: mistake, })`.
- `create` is `J/hooks/useJournalRules.js:47-61`: `fetch(`/api/j2/accounts/${encodeURIComponent(accountId)}/rules`, { method: 'POST', ... body: JSON.stringify({ label, evidence: evidence ?? null, sourceType: sourceType ?? null, sourceId: sourceId ?? null, }), })`.
- Server `api/routers/journal_two.py:1070` `@router.post("/accounts/{account_id}/rules")`; its docstring `Body: {label, evidence?, sourceType?, sourceId?}`. `S/journal_rules.py:82` `create_rule(user_id, account_id, label, evidence, source_type, source_id)` returns `"beforeEntry": False` (`:138`). `_VALID_SOURCE_TYPES = {"psychology", "review", "manual", "chat"}` (`:36`); the label is capped at 200 characters.
- **The create door takes no before-entry field.** The column is `S/db.py:2095` `"ALTER TABLE j2_journal_rules ADD COLUMN before_entry INTEGER NOT NULL DEFAULT 0"`; the JSON key is camelCase `beforeEntry`. It is set only through the edit door: `J/lib/blocks/rulesApi.js:27-31` `export async function editRule(ruleId, patch) { ... fetch(`/api/j2/trader-blocks/rules/${encodeURIComponent(ruleId)}`, { method: 'PUT', ...` and `S/rule_versions.py:96` `if "beforeEntry" in patch and not isinstance(patch["beforeEntry"], bool)` / `:137-139` `sets.append("before_entry = ?")`.
- Write-door rail: `J/lib/blocks/blockDoors.test.js:50-65` `WRITE_EXCEPTIONS` names `rulesApi.js` `{ method: 'PUT', url: '/api/j2/trader-blocks/rules/{}', ...}`. The rail scans only `components/notebook/blocks/`, `lib/blocks/` and `LogTradeChecklist.jsx` (`:4`), so `components/insights/*` (where `MakeRuleButton` and `useJournalRules` live) is outside it.

### V10: `playbook_stats`, adherence, rule versions

- `S/playbook_stats.py:102-109` `def get_playbook_stats(user_id, account_id=None, *, spec: FilterSpec | None = None, conn=None, with_trades: bool = False) -> list[dict[str, Any]]:` selects `FROM j2_trades WHERE user_id = ? AND setup IS NOT NULL AND TRIM(setup) != ''`, scoped by `account_id` and `trades_where(spec)` (a `FilterSpec(date_from, date_to)` is the date range). It sorts by `totalPnlDollar` descending (`:164`), not by expectancy. Per setup (`:192-303`): `"tradeCount"`, `"expectancy"` (dollars), `"expectancyR": avg_r` (`avg_r` may be `None`), `"sample": sample_size.sample(trade_count)`.
- `S/sample_size.py:63-69` `def band(n)` returns `'too_few'` (n < 10), `'thin'` (n < 25) or `'normal'`; `:72-75` `sample(n)` returns `{n, band, wording}`.
- `S/db.py:1798-1802` `j2_trade_adherence (user_id TEXT NOT NULL, trade_ref TEXT NOT NULL, setup TEXT, checked_rule_ids TEXT NOT NULL DEFAULT '[]', total_rules INTEGER, adherence_pct REAL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, trade_ref))`. There is no account column, no trade date and no month; the trade is reached through `trade_ref_for_row(row)` (`S/trade_refs.py:19`: `ext:<external_id>` for a broker row, else `id:<row id>`). `S/adherence_store.py` documents `adherence_pct` as `min(len(checked)/total_rules, 1.0)` when `total_rules > 0`, else `0.0`, never `None`.
- `S/db.py:388-399` `j2_journal_rule_versions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, rule_id TEXT NOT NULL, version INTEGER NOT NULL, label TEXT NOT NULL, evidence TEXT, changed_at TEXT NOT NULL, change_note TEXT, UNIQUE (rule_id, version))`. `rule_versions.edit_rule` writes a new version only when label or evidence changes (`:130-136`), and `record_v1` writes v1 when the rule is made.
- `S/analytics.py:224` `_effective_r_map(rows, excursions_map) -> tuple[dict[Any, float], dict[str, int]]` returns `{row id: R}`; the excursions map is `excursions_store.list_excursions_for_user(user_id, conn=conn)` (`:142`). `S/filters.py` `ANALYTICS_INCLUDED_SQL` carries the `analytics_excluded` predicate and `_fetch_trades` applies it.
- Tags: `j2_trades.emotion_tags` and `mistake_tags` are JSON-array TEXT (`S/filters.py:69-81` matches either).

### V11: Report page, InsightsHub, lazy routes

- Report page: `J/components/ReportPage.jsx` (361 lines), lazy in `app/src/App.jsx:144` `const J2ReportPage = lazy(() => import('./pages/journal-2-0/components/ReportPage'))`, route `:743` `<Route path="/journal-2-0/report" element={<><J2RouteFocus /><J2ReportPage /></>} />`. It is a print-friendly page opened in a new tab by `components/GenerateReportModal.jsx:94` (`const url = `/journal-2-0/report?${params.toString()}``), driven by query params (`from`, `to`, `period`, `account_id`, `sections`). It fetches `/api/j2/analytics` always (`:46`) and `/api/j2/trades` only when `show('trades')` (`:53-56`).
- Lazy route idiom (`App.jsx:742-747`): a `const J2X = lazy(() => import('./pages/journal-2-0/components/...'))` plus `<Route path="/journal-2-0/x" element={<><J2RouteFocus /><J2X /></>} />`. Every such route also has a row in `app/src/surfaces/manifest.js` (`:102` `{ path: "/journal-2-0/report", pathKind: "literal", element: "J2ReportPage", kind: "surface", order: null },`), which `app/src/surfaces/manifest.test.js` derives from `App.jsx` and fails by name.
- A dark standalone page: `J/components/insights/MyPlaybook.jsx:234` `if (!on) return <Navigate to="/journal/insights" replace />`. The Journal has no not-found page for its own routes.
- InsightsHub: `J/components/insights/InsightsHub.jsx:54-61` `SECTIONS = [playbook, exit, edge, psychology, regime, coach]`, then `:64` `DISCIPLINE_SECTION = { key: 'discipline', label: 'Discipline' }` and `:67` `REVIEWS_SECTION`, added by `:88-92` `const sections = [...SECTIONS, ...(planGradingEnabled() ? [DISCIPLINE_SECTION] : []), ...(reviewDraftsEnabled() ? [REVIEWS_SECTION] : []),]`. The key rides in `?ins=`; one section mounts at a time. Psychology gets `analytics` and `accountId` (`PsychologySection.jsx:92`).

### V12 (measured): first-open closure and headroom

Command, from the worktree root after `cd app && npm run build` (exit 0, `evidence/.../npm-build.log`):
`python tools/notebook_perf_budgets.py --dist app/dist`
Raw output, `evidence/t3-verify-20261017T153803Z/v12-perf-budgets-raw.txt`, verbatim:

```
bytes.notebook_first_open: 2,235,797 B across 60 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
VERDICT: PASS -- within every budget checked
```

- Closure: **2,235,797 B** (60 chunks), at the tree `5626a6462c`.
- Budget (`docs/notebook/perf-budgets.json` `bytes.notebook_first_open.max`): **2,260,793 B**.
- Headroom = 2,260,793 - 2,235,797 = **24,996 B**. The plan's allowance is +700 B, so **HEADROOM OK**.
- The `perf-budgets.json` baseline is 2,153,137 B; the closure sits 82,660 B above that recorded baseline and inside the 5% line. The controller's PR #373 merge is in this tree. The base without PR #373 was not measured.
- Task 10's cap becomes closure at most 2,235,797 + 700 = 2,236,497 B on this base. If master moves (it has: `51482ceac2`) the last lander re-measures.

## Differs

Items where the plan's text does not match the code read above. Each names the plan task it changes.

| # | Plan says | Code says | Changes |
|---|---|---|---|
| D1 | Task 3: `moodCheckIn` registry params `mood` and `focus` are `type: 'enum'`, with `journalBlocks.js` `settings: Object.freeze([])`. | `registry.test.js:704-706`: a block with `kind.settings.length === 0` must have **no** `enum` in its `paramsSchema`. As planned, S20 fails. Either the two params become `type: 'string'` in the registry (`coerce` for `'string'` drops `''`, `registry.js:1050-1053`, so the default `''` is re-applied by `normalizeParams`), or the catalog carries settings on both sides and in the Node rail, which would also expose mood and focus as style settings. | Task 3 (controller ruling needed on the registry type) |
| D2 | Task 3 file list names no test files. | Hand-typed lists that go red on a new id: `registry.test.js:44-57` (`IDS`) and `:60-61` (`BLOCK_IDS`, asserted at `:654`); `tests/test_trader_blocks.py:31` (`assert tb.BLOCK_IDS == (...)`) and `:39`; `tests/test_notebook_journal_styles_router.py:85` (`listing["blockKinds"] == [...]`); `tests/test_notebook_perf_harness.py:624` (`kinds == [*tb.BLOCK_IDS, "marketcontext"] == list(h.TRADER_BLOCK_KINDS)`) against `tools/notebook_perf_harness.py:566-569`. | Task 3 (add all of these to its file list); Task 10 Step 3 (the harness tuple is also the "one of every block" instrument) |
| D3 | Task 9 generates fixtures for the three new endpoints only. | `app/src/pages/journal-2-0/__fixtures__/contract/journal-styles.list.json` and `journal-styles.list.empty.json` carry `body.blockKinds` (12 ids) and are generated by `tools/notebook_contract_fixtures.py` (`--check` exits 1 when a committed file differs). Adding a kind changes `GET /api/j2/journal-styles`, so the regeneration belongs to Task 3. `lib/__fixtures__/journalStylesComposed.json` also names block ids. | Task 3 (regenerate), Task 9 |
| D4 | Task 3: `useBlockParams().setParams(...)`. | `J/components/notebook/blocks/useBlockParams.js:10` `export function useBlockParams({ attrs, updateAttributes, editable })` **returns the setter function itself** (a `useCallback(patch, opts)`), merging `patch` into the latest params. Call `const setParams = useBlockParams({...}); setParams(nextCheckinParams(...))`. | Task 3 (block body and its test mock) |
| D5 | Task 3: the block body takes `todayET()` for the day rule. | `todayET` is `J/lib/calendar.js:123` (Intl-based, ET). `blockDoors.test.js` rule ④ lets a block file import only another block file or a module named in `IMPORT_ALLOW` (`:74-100`); `lib/calendar` is not named. Task 3 must add an `IMPORT_ALLOW` entry with a reason (calendar.js has no imports). A second `todayET` exists at `lib/tradeCanvas.js:87`; use the calendar one. | Task 3 |
| D6 | Task 3: `checkinWords.js` under `J/lib/blocks/`. | That directory is scanned by `blockDoors.test.js` (`:30-31`), so the file is subject to rules ①-④. A pure, import-free module passes; the psychology leaf (`components/insights/CheckInOutcomes.jsx`) importing from `lib/blocks/` is outside the rail and fine. Noted so it stays import-free. | Task 3 (note only) |
| D7 | Task 4 and Review Focus 2: trash "drops" the check-in from the sidecar and restore "returns it". | V7: trash and restore leave every sidecar untouched, and sidecars are filtered at read time by the `j2_notes` join (`deleted_at IS NULL`). Hard delete is explicit for embeds and mentions (`notes.py:4369-4370`) and by trigger for the rest. So for check-ins: trash keeps the row, restore does nothing, Task 5 excludes trashed notes through its join, and `purge_expired_deleted_notes` needs `DELETE FROM j2_note_checkins WHERE note_id = ?` (or an `AFTER DELETE ON j2_notes` trigger in `db.py`). Test case 4 passes as written ("or excludes it"); the Review Focus 2 sentence should read "excluded while trashed, present again on restore". | Task 4, Task 5, Review Focus 2 |
| D8 | Task 4 lists `db.py`, `notes.py` and the purge module. | `docs/account-deletion-manifest.md` is generated by `tools/account_deletion_manifest.py` and `tests/test_account_deletion_manifest.py` fails by name when the doc and `_DIRECT_USER_TABLES` disagree. The doc must be regenerated in Task 4. | Task 4 |
| D9 | Task 6 test 3 and R-T3-6: accepting calls "the rules create door once with `before_entry` true". "ONE write", "allow only GET plus the one rules POST". | The create door (`POST /api/j2/accounts/{id}/rules`) accepts only `{label, evidence, sourceType, sourceId}` and always returns `beforeEntry: false` (`journal_rules.py:138`). Setting it needs a **second** write: `PUT /api/j2/trader-blocks/rules/{id}` with `{"beforeEntry": true}` (`rulesApi.editRule`). The JSON key is `beforeEntry`; `before_entry` is the column only. Options: (a) two calls, then the "one write" claim and test 5 change; (b) extend the create door to accept `beforeEntry` (server change plus its rail). A controller ruling is needed. | Task 6 (R-T3-6, tests 3 and 5, Review Focus) |
| D10 | Task 6: "opens `MakeRuleButton`'s confirm with the label pre-filled and editable and the evidence line read-only". | `MakeRuleButton`'s props are `{ mistake, count, total, accountId, onCreated }`; label and evidence are derived inside from `mistake`/`count`/`total` (`:49-51`, `:77`). It cannot take a pre-filled label. `ChecklistFromWinners` either needs `MakeRuleButton` generalised (new `label` / `evidence` props, with `PsychologySection` unchanged) or its own confirm over `useJournalRules(accountId).create`. | Task 6 |
| D11 | Task 6: "`blockDoors` rail names `rulesApi.js` as the exception". | `blockDoors.test.js` scans only `components/notebook/blocks/`, `lib/blocks/` and `LogTradeChecklist.jsx`. `ChecklistFromWinners` (under `components/insights/`) is outside it; its writes go through `useJournalRules`, which is not covered by that rail. No exception entry is needed, and `rulesApi.js` is relevant only if D9(a) uses `editRule`. | Task 6 |
| D12 | Task 1 Step 2 and Task 5 Step 4: `tests/test_journal_two_analytics*.py` and "every existing analytics test file". | The glob matches nothing. Analytics tests live in `api/services/journal_two/test_analytics*.py` / `test_*.py` beside the code and in `tests/test_analytics_exclusion_coverage.py` (the only `tests/` file that names `_psychology_section` or the analytics service). Task 5's regression run must name those files by hand. | Task 5 Step 4 |
| D13 | Task 7: `"sample": "too_few"|"thin"|"ok"`. | `sample_size.band()` returns `'too_few'`, `'thin'` or `'normal'` (`sample_size.py:63-69`) and the plan says "map them exactly". `ok` is not a band name; use `'normal'` (or map explicitly and name the mapping). | Task 7 |
| D14 | Task 7: bestSetups are "the top 3 setups by expectancy" and "Use V10's existing functions". | `get_playbook_stats` sorts by `totalPnlDollar` descending and `expectancyR` can be `None`; the top-3-by-expectancy order is a re-sort of its result (None last). Its range filter is `FilterSpec(date_from, date_to)`, applied over the `trading_day_et`/`exit_date` spine. | Task 7 |
| D15 | Task 7 and R-T3-9: discipline "monthly mean `adherence_pct` from `j2_trade_adherence` for trades closed that month ... scoped to the account picker". | `j2_trade_adherence` has no account, date or month column; each row is keyed by `trade_ref` and must be joined in Python through `trade_ref_for_row` against the year's `j2_trades` rows (as `playbook_stats` does). `adherence_pct` is never NULL: a record with `total_rules = 0` stores `0.0`, so a month whose only records have no rules reads 0, not `—`. Task 7 must decide whether `total_rules = 0` records count. Open positions are keyed `pos:<id>` and never join. | Task 7 (R-T3-9, test 3) |
| D16 | File map: `J/pages/WrappedPage.jsx` (new, lazy). | `J/` has no `pages/` directory. Neighbours are `J/components/ReportPage.jsx` and `J/TrackRecordPage.jsx`. Use `J/components/WrappedPage.jsx` (like `ReportPage`) or `J/WrappedPage.jsx`. | Task 8 file list |
| D17 | Task 8: add "one lazy route, in V11's idiom". | Also add the row to `app/src/surfaces/manifest.js` (`kind: "surface"` or `"detail"`, `order: null`); `manifest.test.js` derives the set from `App.jsx` and fails by name. `reachable.test.js` needs the page imported from `App.jsx`. | Task 8 file list |
| D18 | Task 8 test 1: "with the switch off ... the route renders the Journal's not-found". | The Journal has no not-found page. The dark-page precedent is `MyPlaybook.jsx:234` `<Navigate to="/journal/insights" replace />`. | Task 8 test 1 |
| D19 | Task 8: "Years come from the trade list the Report page already holds; never a new fetch." | `ReportPage` fetches `/api/j2/trades` only when the URL's `sections` include `trades` (`:53-56`); otherwise it holds only `analytics`. It is a print-friendly page opened from `GenerateReportModal`, whose own state does not hold a trade list either. A year picker for earlier years has no data source on that page without a new read. The door belongs on a surface that already has the years, or the picker takes a new, cheap read. | Task 8 (R-T3-8, door placement) |
| D20 | Task 6: "the InsightsHub section list (V11)" and Task 5 `PsychologySection.jsx`. | `InsightsHub` section keys are `playbook, exit, edge, psychology, regime, coach` plus the conditional `discipline` and `reviews`. The idiom for a flag-gated section is `...(flag() ? [SECTION] : [])` at `:88-92`; use it for the new section (`tier3Enabled()`), not a fixed array. | Task 6 (note) |
| D21 | Plan and brief cite `tests/test_journal_styles_store.py:35,48`. | The Node rail is at `:31` (`_client_blocks`) and `:41` (`test_the_client_block_catalog_equals_the_server_catalog`). Line drift only. | Task 3 (cite) |
| D22 | Global Constraints and Task 3: the +700 B covers `journalBlocks.js` as first-open. | The slash menu's own comment (`SlashMenu.jsx:32-35`) says `journalBlocks.js` "is NOT first-open". The first-open cost of the block is the registry row, the `BLOCK_COMPONENTS` line, the slash item, the `tier3Flag` helper and the `FLAG_FALLBACKS` row. The allowance is therefore, if anything, generous. | Task 3 and Task 10 Step 4 (note only) |

Not a difference, recorded because the plan relies on it: `notes.py:357` is `_sync_note_sidecars` (plan cites 357); the walk's `widgetEmbed` branch already reads `attrs.params` and `attrs.widgetId`, and `embedId` is on `attrs` (it is built by `trader_blocks._node`: `"embedId": uuid.uuid4().hex`), so Task 4's three conditions are all readable in that branch.
