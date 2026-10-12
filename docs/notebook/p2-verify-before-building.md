# Notebook P2a: verify before building

Task 1 of `docs/superpowers/plans/2026-10-12-notebook-p2-trader-blocks-t1.md` (plan commit
`268408de25`, branch `notebook-presets-spec`). Every later P2a task cites this file. Every quote
below was re-read at write time: the grep was run, the matched line's CONTENT was read, and the
row says what the line says.

- **Tree measured:** `git rev-parse HEAD` = `450670dbee8ea346260502fe6b403ad6ae41c311`
  (branch `notebook-p2-blocks`, made from `origin/master` at Task 0; it is master's PR #320 merge).
- **Measured:** 2026-10-12, worktree `C:\Users\Patrick\uct-worktrees\notebook-p2`.
- **uct-intelligence:** `782b879496f96cc47fd1c7e9bf39cf9fa1f8a6c2` 2026-10-02 (the commit the plan's
  R-P2-5 cites).

## §baseline

Task 0 Step 4, run in this tree.

**Backend** (named files: `test_journal_styles_store`, `test_journal_styles_compose`,
`test_journal_styles_update`, `test_notebook_journal_styles_router`, `test_notebook_contract_fixtures`,
`test_note_kind_property`, `test_gate_shards`, `test_public_note_payload`). Totals line:

    FAILED tests/test_gate_shards.py::test_the_pinned_glob_IS_the_installed_vitests_default_include
    1 failed, 568 passed, 2 skipped, 27720 warnings in 117.73s (0:01:57)

The one red is **environmental, not master's**: its assertion reads
`app/node_modules/vitest/dist/config.cjs`, and this tree has no `app/node_modules` (see below). The
two skips are the opt-in real-vitest rails (`UCT_RUN_REAL_VITEST=1`, and the process-count sampler).

**Frontend: NOT RUN.** The `app/node_modules` junction to
`C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules` (Task 0 Step 3) was refused by the
session's permission system, so no worktree made by Task 0 has `node_modules` and `npx vitest` cannot
start in any of them. The vitest baseline (`registry.test.js`, `WidgetEmbedView.unknownKind.test.jsx`,
`doorEnumeration.test.js`, `usePreferences.additionsOnly.test.js`, `keyListenerCensus.test.js`,
`reachable.test.js`, `surfaceCoverage.test.js`, `NewNoteMenu.listCaret.css.test.js`) is therefore
**not measured**, and no frontend red is recorded as pre-existing. The shared install read 377
entries (`Get-ChildItem -Force`) before the attempt; nothing was written to it.

## §cite

Step 1's 68 greps, each printing exactly ONE line (an empty result would be a failed check). The
table is rendered from the grep output itself, never retyped. "plan-time" is the `file:line` the
brief recorded at master `d92fca5be9`; blank where it recorded none.

| # | claim | `file:line` | plan-time | the line, quoted |
|---|---|---|---|---|
| 1 | journal_styles.py declares the ONE-FACT-IN-TWO-FILES pairing with journalBlocks.js | `api/services/journal_two/journal_styles.py:49` |  | `` # ⛔ ONE FACT IN TWO FILES with app/src/pages/journal-2-0/lib/journalBlocks.js (ids, settings keys, `` |
| 2 | BLOCK_BUILDERS is the block-id -> builder map (P1 left only `chart`) | `api/services/journal_two/journal_styles.py:647` |  | `` BLOCK_BUILDERS: dict[str, Callable[[dict, dict], tuple[dict \| None, str \| None]]] = {"chart": _build_chart} `` |
| 3 | `_plan`'s builder ctx (no `mode` yet; Task 1A adds it) | `api/services/journal_two/journal_styles.py:920` |  | `` ctx = {"ticker": row["ticker"], "now": datetime.now(timezone.utc)} `` |
| 4 | journalBlocks.js header line (P1 left the seam for P2) | `app/src/pages/journal-2-0/lib/journalBlocks.js:2` |  | `` // is a widgetEmbed node with that widgetId (docs/notebook/p1-verify-before-building.md §a). P1 can `` |
| 5 | WidgetEmbedView's embed binding map | `app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx:48` |  | `` const EMBED_COMPONENTS = { `` |
| 6 | `marketcontext` is bound to MarketContextEmbed (IR-S6) | `app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx:56` |  | `` marketcontext: lazyLeaf(() => import('./MarketContextEmbed')), `` |
| 7 | WidgetEmbedView's error boundary | `app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx:83` |  | `` class EmbedErrorBoundary extends Component { `` |
| 8 | the unknown-block sentence (switch gates creating, never rendering) | `app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx:140` |  | `` export const UNKNOWN_BLOCK_SENTENCE = 'This block needs a newer version of the app. Reload to see it.' `` |
| 9 | WidgetEmbedView's share-view read | `app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx:208` |  | `` const shareView = !!editor?.storage?.uctJournalWidgets?.shareView `` |
| 10 | WidgetEmbedView's export (signature) | `app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx:178` |  | `` export default function WidgetEmbedView({ node, selected, editor, updateAttributes, deleteNode, getPos }) { `` |
| 11 | block state rides `params` (no new attribute) | `app/src/pages/journal-2-0/lib/widgetEmbedNode.jsx:118` |  | `` params: jsonAttr('data-params', {}), `` |
| 12 | the registry's capture-only branch | `app/src/widgets/registry.js:263` |  | `` if (manifest.captureOnly === true) { `` |
| 13 | the existing `marketcontext` registry entry | `app/src/widgets/registry.js:464` |  | `` marketcontext: { `` |
| 14 | `marketcontext` reconstructable from `params.readings` | `app/src/widgets/registry.js:497` |  | `` reconstructable: (p) => !!(p?.readings && typeof p.readings === 'object' && !Array.isArray(p.readings)), `` |
| 15 | the registry's plain-text export for search | `app/src/widgets/registry.js:1034` |  | `` export function paramsPlainText(widgetId, params) { `` |
| 16 | `readingsFrom`, the one readings derivation | `app/src/pages/charts/widgets/marketContextModel.js:10` |  | `` export function readingsFrom(breadth) { `` |
| 17 | registry.test.js pins the widget-id list | `app/src/widgets/registry.test.js:55` |  | `` it('registers exactly the 20 workspace widget types + the G-040 capture-only kinds, in menu order', () => { `` |
| 18 | registry.test.js embed-binding rail (IR-B2) | `app/src/widgets/registry.test.js:563` |  | `` it('reconstructable widgets and journal embed bindings cannot drift apart', () => { `` |
| 19 | registry.test.js capture-only list | `app/src/widgets/registry.test.js:51` |  | `` const CAPTURE_ONLY = ['screener', 'cot', 'modelbook'] `` |
| 20 | vendor row: market context is `mixed` | `api/services/journal_two/public_note_payload.py:180` |  | `` ("widgetEmbed", "marketcontext"): "mixed",    # regime + prices `` |
| 21 | vendor row: the price fact is `massive` (IR-B3) | `api/services/journal_two/public_note_payload.py:203` |  | `` ("financialFact", "massive"): "massive",      # the `price` fact type `` |
| 22 | the vendor-row rail parametrizes over the registry | `tests/test_public_note_payload.py:664` |  | `` def test_every_registered_widget_has_a_vendor_row(widget_id): `` |
| 23 | the slash menu's Trading group | `app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx:285` | :285 (same) | `` { id: 'trading', label: 'Trading' }, `` |
| 24 | the slash menu's Trading-group membership set | `app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx:293` | :293 (same) | `` const TRADING_BLOCKS = new Set(['Trade-plan canvas', 'Transcript passage', 'Journal style']) `` |
| 25 | the `/price` fetch body (pinned by its factType) | `app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx:396` | :396 (same) | `` body: JSON.stringify({ ticker: symbol, factType: 'price' }), `` |
| 26 | `financialFact` is a block node (R-P2-2) | `app/src/pages/journal-2-0/lib/financialFactNode.jsx:25` | :25 (same) | `` group: 'block', `` |
| 27 | the ONE resolver's cashtag tier (R-P2-3) | `app/src/lib/tickerResolver.js:32` |  | `` export function resolveCashtags(text) { `` |
| 28 | the resolver imports the taxonomy JSON (IR-S12) | `app/src/lib/tickerResolver.js:17` |  | `` import A8 from './taxonomy/a8Taxonomy.json' `` |
| 29 | `importWithOneRetry` (lazy load on first use) | `app/src/pages/journal-2-0/lib/lazyChunk.js:61` |  | `` export function importWithOneRetry(load, waitMs = RETRY_WAIT_MS, accept = hasDefault) { `` |
| 30 | the user-settable built-in set | `api/services/journal_two/note_properties.py:118` |  | `` BUILTIN_USER_SET_IDS = frozenset(d["id"] for d in BUILTIN_PROPERTY_DEFS if d["source"] == "user_set") `` |
| 31 | a non-settable built-in is refused (Review Focus 4) | `api/services/journal_two/note_properties.py:456` | :456 (same) | `` raise PropertyValidationError(f"{property_id} is not a settable property") `` |
| 32 | `property_filter` refuses non-`user_set` (R-P2-6) | `api/services/journal_two/note_properties.py:727` | :727 (same) | `` if prop_def["source"] != "user_set": `` |
| 33 | notes.py's validation error type (IR-S2) | `api/services/journal_two/notes.py:147` | :147 (same) | `` class NoteValidationError(ValueError): `` |
| 34 | create_note writes properties with replace=True | `api/services/journal_two/notes.py:3319` | :3319 (same) | `` properties_json = set_note_properties(user_id, new_id, properties, conn, replace=True) `` |
| 35 | a version restore replaces properties | `api/services/journal_two/notes.py:3598` | :3598 (same) | `` "propertiesReplace": version["propertiesJson"] or {}, `` |
| 36 | update_note forwards replace to set_note_properties | `api/services/journal_two/notes.py:3767` | :3767 (same) | `` new_properties_json = set_note_properties(user_id, note_id, raw, conn, replace=replace) `` |
| 37 | the PUT route pops only `baseUpdatedAt` ... (IR-S1) | `api/routers/journal_two.py:3610` | :3610 (same) | `` base = patch.pop("baseUpdatedAt", None) if isinstance(patch, dict) else None `` |
| 38 | ... and `locked` (IR-S1) | `api/routers/journal_two.py:3614` | :3614 (same) | `` patch.pop("locked", None) `` |
| 39 | the adherence store's upsert | `api/services/journal_two/adherence_store.py:55` |  | `` def upsert_adherence( `` |
| 40 | the adherence GET reads `detail["tradeRef"]` | `api/routers/journal_two.py:1020` | :1020 (same) | `` return adherence_store.get_adherence(user["id"], detail["tradeRef"]) `` |
| 41 | the trade dict carries `positionId` | `api/services/journal_two/trades.py:944` |  | `` "positionId": row["position_id"], `` |
| 42 | the placeholder account size (IR-S9) | `api/services/journal_two/accounts.py:59` | :59 (same) | `` _DEFAULT_ACCOUNT_SIZE = 100_000.0 `` |
| 43 | every new account gets the placeholder size | `api/services/journal_two/accounts.py:67` | :67 (same) | `` "accountSize": _DEFAULT_ACCOUNT_SIZE, `` |
| 44 | LogTradeButton's handleCreateTrade (IR-S7) | `app/src/pages/journal-2-0/LogTradeButton.jsx:105` |  | `` const handleCreateTrade = useCallback(async (payload) => { `` |
| 45 | JournalLogFab's handleCreateTrade (IR-S7) | `app/src/pages/journal-2-0/JournalLogFab.jsx:98` |  | `` const handleCreateTrade = useCallback(async (payload) => { `` |
| 46 | AddTradeModal discards onSave's value (IR-S7) | `app/src/pages/journal-2-0/components/AddTradeModal.jsx:128` | :128 (same) | `` await onSave({ `` |
| 47 | AddPositionModal keeps onSave's value | `app/src/pages/journal-2-0/components/AddPositionModal.jsx:349` | :349 (same) | `` const created = await onSave(payload) `` |
| 48 | usePreferences' return shape | `app/src/hooks/usePreferences.js:385` | :385 (same) | `` return { prefs, setPref, setPrefMerged, loading: isLoading } `` |
| 49 | live_prices' shared cache TTL (IR-S5) | `api/routers/live_prices.py:32` | :32 (same) | `` _CACHE_TTL = 15     # seconds — applies to both the whole-set and per-ticker caches `` |
| 50 | live_prices' route function (IR-S5) | `api/routers/live_prices.py:620` |  | `` def get_live_prices( `` |
| 51 | breadth_live lists `vix` under NOT_LIVE (IR-S5) | `api/services/breadth_live.py:125` | :125 (same) | `` "vix", "vxn", "avg_10d_vix", "avg_10d_vxn", "vxmt", "vix_term_structure", `` |
| 52 | entry_context's regime reader (V4) | `api/services/journal_two/entry_context.py:328` | :328 (same) | `` def _regime_fields(memo: dict) -> tuple[dict, dict]: `` |
| 53 | entry_context's breadth `detail` object (IR-S4) | `api/services/journal_two/entry_context.py:368` | :368 (same) | `` {"universe": "wire", "liveUnavailable": live.get("reason")}) `` |
| 54 | the regime reader (V4) | `api/services/journal_two/regime.py:54` |  | `` def get_current_regime() -> dict[str, Any]: `` |
| 55 | the switch: NOTEBOOK_JOURNAL_STYLES_ENABLED is an enablement gate | `api/routers/auth.py:265` |  | `` "NOTEBOOK_JOURNAL_STYLES_ENABLED": False,  # enablement — unset means OFF (journal styles, P1) `` |
| 56 | the preference-key allow-list | `api/routers/auth.py:2759` |  | `` _PREFERENCE_KEYS = { `` |
| 57 | the preference-key additions-only rail | `app/src/hooks/usePreferences.additionsOnly.test.js:110` |  | `` const BASELINE_KEYS = { `` |
| 58 | the gate's read set | `scripts/gate_shards.py:334` |  | `` GATE_READ_PATHS = ( `` |
| 59 | the door census rail ① | `app/src/pages/journal-2-0/lib/offline/doorEnumeration.test.js:492` |  | `` it('① the SQL names exactly SEVEN functions that advance a note', () => { `` |
| 60 | the a11y population derivation | `app/src/pages/journal-2-0/a11y/population.js:18` |  | `` export function derivePopulation() { `` |
| 61 | the a11y surfaces manifest | `app/src/pages/journal-2-0/a11y/notebookSurfaces.js:18` |  | `` export const SURFACES = Object.freeze({ `` |
| 62 | the bytes budget max | `docs/notebook/perf-budgets.json:11` |  | `` "max": 2260793, `` |
| 63 | the perf harness' doc builder | `tools/notebook_perf_harness.py:554` |  | `` def paragraphs_doc(n: int, tag: str) -> tuple[dict, str]: `` |
| 64 | the perf harness' seeder | `tools/notebook_perf_harness.py:894` |  | `` def _seed(req, base: str, sizes: list[int], run: str) -> dict[int, tuple[str, str]]: `` |
| 65 | the door audit's step kinds | `tools/notebook_door_audit.py:219` |  | `` STEP_KINDS = ("click", "click_css", "hover_css", "open_note", "type") `` |
| 66 | the key-listener census scopes editor keymaps out | `app/src/pages/command/keyListenerCensus.test.js:28` |  | `` * editor keymaps (TipTap/ProseMirror/CodeMirror, scoped to the editor). Neither `` |
| 67 | uct-intelligence's house sizing table (R-P2-5) | `uct-intelligence/uct_intelligence/api.py:2775` | :2775 (same) | `` _SIZING_TABLE = { `` |
| 68 | the ORANGE B cell (R-P2-5) | `uct-intelligence/uct_intelligence/api.py:2784` | :2783 (DIFFERS) | `` ("ORANGE", "B"):  0.00, `` |

Every row printed exactly one line. Every plan-time value matched except row 68: the plan recorded
`api.py:2783` for `("ORANGE", "B")`, and the line is at `:2784`. uct-intelligence's HEAD is the same
commit the plan cites (`782b879496`, 2026-10-02), so the line did not move: the plan's number was off
by one (`:2783` is `("ORANGE", "A"):  0.05,`). Nothing else differs, and no claim is struck.

## §V1: the list caret is on the base. **PASS**

`gh pr view 320` answers `MERGED 450670dbee8ea346260502fe6b403ad6ae41c311`; that commit is
`origin/master` itself (`git merge-base --is-ancestor 450670dbee origin/master` = 0), and
`d92fca5be9` is its ancestor (= 0). `app/src/pages/journal-2-0/components/notebook/NewNoteMenu.listCaret.css.test.js`
exists (4,462 B). Task 2 Step 4 (R28 N1/N2) and Task 13's row-56 measurement both run.

## §V2: the typing baseline of record. **ANSWERED; changes Task 13**

No single run carries 4.94 / 7.07 / 9.37 as `typing_busy_per_char` p95 rows. 26 files under
`docs/notebook/perf-runs/` carry that measure; none reads those p95s. The plan-time matches were
individual RAW samples, not p95s: `ty-l15-quiet/q1.json` `.raw.busy_ms.1[37]` = 4.949 and
`.raw.busy_ms.1000[4]` = 9.377 (its p95 rows read 6.73 / 19.56 / 17.12), and `ty5/ab/A3.json`
`.raw.busy_ms.1[23]` = 7.073 (p95 rows 17.14 / 19.63 / 27.37).

So Task 13 compares against the latest quiet-box record in `docs/notebook/perf-budgets.md`
(section "Quiet re-read with the background marker, 2026-10-09", lines 1006-1028), and says so in
the PR body:

- run `docs/notebook/perf-runs/ty9-quiet-marker/q1.*`, tree `fffb6dba3a` plus the sampler change;
- flags `--boot --busy --sizes 1,1000,2000 --opens 20 --chars 60` (Task 13 runs the same);
- `typing_busy_per_char` p95 at 1 / 1,000 / 2,000 paragraphs: **6.85 / 6.77 / 9.73 ms**; load
  QUIET and background LIGHT at both ends.

## §V3: the bytes headroom. **PASS (from CI at this exact SHA); chunk membership NOT MEASURED**

The local build could not run (no `app/node_modules`; see §baseline). The figure is the
`notebook-bytes.yml` workflow's own run on the base SHA: run `38259413691`, push,
`headSha 450670dbee8ea346260502fe6b403ad6ae41c311`, conclusion success, step
"Notebook JS byte budget" (`python tools/notebook_perf_budgets.py --dist app/dist`):

    bytes.notebook_first_open: 2,238,312 B across 61 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
    VERDICT: PASS -- within every budget checked

**Headroom: 2,260,793 - 2,238,312 = 22,481 B**, above the 3,072 B allowance by 19,409 B. Not a STOP.

**Not measured:** which chunk's module list holds `widgets/registry.js`, `WidgetEmbedView.jsx` and
`lib/tiptap.js`. That needs the Vite manifest, and the CI run uploaded no artifact (0 artifacts).
It is owed by the first lane that can build (`npm run build`, then
`python tools/notebook_perf_budgets.py --dist app/dist --json "$TEMP/p2a-bytes-base.json"`), before
Task 6 spends any of the allowance.

## §V4: the market context readers. **ANSWERED; changes Tasks 1A/11 and Task 3**

- `entry_context._regime_fields` (`entry_context.py:328-348`) answers `(regime_field, exposure_field)`.
  Each is built by `_field` (`:300-302`) or `_missing` (`:305-308`), both returning
  `{value, source, asOf, missing, detail}`. No call in `_regime_fields` passes `detail`, so `detail`
  is `None` on every branch (`detail or None`). It is memoised per capture (`memo["regime"]`).
- It reaches only the wire: `regime.get_current_regime` (`regime.py:54-64`) ->
  `regime._read_exposure` (`:34-51`) -> `engine.get_breadth()["exposure"]`, and `_wire_breadth()`
  (`entry_context.py:322-325`) -> `engine.get_breadth()` for the date.
- **Finding:** `engine._normalize_exposure` (`engine.py:577-590`) emits no `as_of` or `date`, so
  `get_current_regime()["asOf"]` (`regime.py:63`) is ALWAYS `None` from a real wire.
  `_regime_fields` knows this and falls back to the breadth payload's `wire_date` (`:334-338`).
  Task 1A's `build_position_sizing`, as the brief writes it, reads `cur.get("asOf")` and so stores
  `regimeAsOf: ""` in production; its test passes only because the stub supplies `as_of`. Task 11
  (or a 1A follow-up) should date the regime the way `_regime_fields` does.
- `engine.get_breadth()`'s keys against `readingsFrom` (`marketContextModel.js:10-29`): `market_phase`
  (`engine.py:524`), `exposure.score` and `exposure.score_delta` (`:582-583`), `breadth_score`
  (`:522`), `distribution_days` (`:523`), `pct_above_50ma` (`:514`), `pct_above_200ma` (`:515`). All
  present.
- **Cold cache:** `get_breadth` (`engine.py:439-487`) tries the 1 h `breadth` cache, then the state
  file's `breadth_data`, then `wire_data` (cache, then `/data/wire_data.json`), then **a live fetch**,
  `morning_wire_engine.fetch_breadth()` (`:459-463`), unbounded. That import resolves only where
  `morning-wire` sits three levels above `api/services` (`engine.py:44-48`): true for
  `C:\Users\Patrick\uct-dashboard`, false for every `uct-worktrees\*` tree and for Railway, where the
  `except` branch answers a null payload. So a builder inside a create can reach a vendor only on a
  box with no wire and an importable engine; Task 3 should treat a null `get_breadth` as "wire
  unavailable", never retry it.

## §V5: the index quotes. **ANSWERED; the bound is NOT `_SEM_WAIT_S`, which conflicts with IR-S5**

Read end to end, `live_prices.get_live_prices` (`live_prices.py:619-744`):

- Value keys (`:574-598`): `price`, `change_pct`, `change`, `volume`, `day_open`, `day_high`,
  `day_low`, `prev_close`, `day_close`, `ext_price`, `ext_session`, `observed_at` (vendor epoch
  SECONDS, or `None`), plus `prev_change`/`prev_change_pct`. A closed-market row
  (`_last_session_row`, `:347-413`) has `observed_at: None`, `session_close_at` (epoch of the close,
  when proven) and `market_closed: True`.
- The valve: `_MASSIVE_SEM = threading.Semaphore(6)`, `_SEM_WAIT_S = 8.0` (`:95-96`), acquired with
  `timeout=_SEM_WAIT_S` (`:680`).
- Inside the valve: `_fetch_snapshots` -> `client.get_batch_quotes` -> `_typed_get(path, timeout=8.0)`
  (`massive.py:347`), an httpx call with an 8 s timeout per phase. The local token bucket raises
  rather than waits (`massive.py:190-191`).
- The 503 branch (`:722-724`) and the 400s (`:633-638`) RETURN a `JSONResponse`, they do not raise:
  a direct caller gets a response object, not a dict.
- `run_alert_check(live_only)` (`:736-742`) runs only on a freshly built set, and is off-thread
  (`watchlist_alert_service.py:708-747`: non-blocking lock, daemon thread). It does not block, but it
  does evaluate every member's alerts for those tickers, as any member's poll does.

**Verdict:** the worst case is the 8 s valve wait PLUS an 8 s-per-phase vendor call, not
`_SEM_WAIT_S` alone. By the brief's own rule, Task 3 reads the per-ticker cache only
(`cache.get(_px_key(tk))`, `live_px1_{TK}`, 15 s) and says so. **That contradicts IR-S5**, which
rules the read goes through `get_live_prices` because "a cache-only read was usually empty". The
integrator decides; Task 3 must not resolve it alone. Either way Task 3 must handle a
`JSONResponse` return.

## §V6: `get_trade_detail`'s keys. **ANSWERED; changes Task 5**

`trades.get_trade_detail` (`trades.py:1105-1170`) returns
`{"trade": <_row_to_trade dict>, "tradeRef": ..., "brokerActivities": [...], ...}`. `tradeRef` is
TOP-LEVEL (`:1168`, read by the adherence routes at `journal_two.py:1020`) and also inside `trade`
(`:973`). `positionId` is ONLY inside `trade` (`:944`). Task 5 reads `detail["trade"]["positionId"]`,
not `detail["positionId"]`. A manual closed trade's `positionId` is a `manual-{uuid}` sentinel
(`journal_two.py:1294`), so the `pos:` fallback finds nothing for it.

## §V7: how Properties shows a built-in a member cannot set. **PASS, nothing more needed**

`PropertiesSection.jsx`: every non-`user_set` property renders read-only
(`disabled={p.source !== 'user_set' || ...}`, `:509`; plain text at `:613-619`), and is shown once
it has a value (`:141`). "Add property" lists only `user_set` properties (`hidden`, `:151-158`). A
`source: "captured"` built-in is therefore shown read-only and never offered. Task 4 needs no change
here.

## §V8: grouping the Board by a built-in select. **ANSWERED; changes Task 4 (and Task 9's sentence)**

- Offered: `NoteBoardView.groupableDefs` (`:41-47`) offers every `select` with options; it never
  reads `source`, and `isOfferable` (`lib/kindOfNoteOffer.js:12-15`) gates only Kind of note. A
  captured select built-in IS offered as a grouping.
- URL: `?view=board` opens the Board (`NotebookTab.jsx:714-723`, then rewritten to `?view=all`). No URL
  form sets the grouping: it comes from a saved view's `spec.groupBy` (`:2693`) or the Board's own
  picker. Task 9's sentence is: open Notes, choose Board, pick "Regime at write" in the group picker.
- **Hazard:** every card carries a move `<select>` disabled only while busy (`NoteBoardView.jsx:338`),
  and `move` (`:207`) writes the grouped property. Grouped by `builtin:regime_at_write`, a member
  could "move" a note to another regime: under IR-S1 the server strips or refuses that write, so the
  card would bounce back. Task 4 must make the Board read-only (no drag, no move select) when the
  grouping property's `source` is not `user_set`, with a test.

## §V9: what a price fact looks like. **ANSWERED (Task 13's walk asserts this text)**

`FinancialFactView.jsx` for a `price` fact (`fact_registry.py:47-49`: label `Price`, unit
`usd_per_share`, `live_and_snapshot`, rights `independent`):

- header: the ticker, then `Price`, then a remove button (`aria-label` "Remove captured fact from note");
- rows: `Captured $X.XX`; `Current $Y.YY` (or "Couldn't refresh"); when both are numbers,
  `Change +$Z.ZZ (+P.PP%)`;
- footer: `Captured Mon D, YYYY, h:mm AM` (`toLocaleString('en-US', ...)` in the BROWSER's time zone,
  not ET); no Source line (an `independent` fact).
- Loading: a skeleton with `aria-label` "Loading captured fact…"; a failed read says "This captured
  fact didn't load."

## §V10: the TipTap Enter order. **ANSWERED**

`@tiptap/core` 3.23.6, `dist/index.js`: `get plugins()` (`:3701-3764`) runs
`sortExtensions([...this.extensions].reverse())` (`:3703`); `sortExtensions` (`:1750-1762`) is a
stable sort by `priority`, highest first (default 100). Each extension's `addKeyboardShortcuts`
becomes ONE `keymap(...)` plugin (`:3713-3731`), and ProseMirror tries plugins in order until one
returns true. So at equal priority a LATER extension's keymap runs FIRST; a higher priority runs
before a lower one regardless of order; a handler returning `false` passes the key to the next
keymap and finally to the core `Keymap` extension's default Enter (`:4243`). Task 10's test proves
the outcome in a real editor.

## §V11: what the Log Trade dialogs return. **ANSWERED (Task 8, IR-S7)**

- `LogTradeButton.jsx`: `handleCreatePosition` returns `created` (`:91-103`, `:102`);
  `handleCreateTrade` (`:105-113`) returns nothing (it reads `res.symbol` for the toast only).
- `JournalLogFab.jsx`: the same pair, byte-identical (`:86-96` returns `created`; `:98-106` returns
  nothing).
- `AddTradeModal.handleSave` (`:122-...`) does `await onSave({...})` (`:128`) and keeps nothing.
- `POST /api/j2/trades` (`journal_two.py:1288-1303`) returns `trades.create_trade_manual`'s dict, whose
  id key is **`id`** (`trades.py:528-529`), beside `positionId` (a `manual-{uuid}` sentinel).

## §V12: the two signatures. **ANSWERED (Task 4)**

    notes.py:3263  def create_note(user_id: str, payload: dict[str, Any] | None = None,
                       conn: sqlite3.Connection | None = None, *, daily_date: str | None = None,
                       properties: dict[str, Any] | None = None,
                       style_stamp: tuple[str | None, int | None, str] | None = None) -> dict[str, Any]:
    note_properties.py:421  def set_note_properties(user_id: str, note_id: str, patch: dict[str, Any],
                       conn: sqlite3.Connection, *, replace: bool = False) -> str | None:

Task 4 adds `captured_properties` to the first and `captured` to the second, both keyword-only.

## §V13: the accounts list and settings routes. **ANSWERED (Task 13)**

- `GET /api/j2/accounts` (`journal_two.py:1583-1600`) answers `{"accounts": [...]}`, not a bare list.
- `GET /api/j2/accounts/{id}/settings` (`:1720-1728`) answers the settings dict (404 when not the
  member's).
- `PUT /api/j2/accounts/{id}/settings` (`:1731-1744`) -> `accounts.upsert_account_settings`
  (`accounts.py:1009-...`), which validates the WHOLE payload and overwrites every column
  (`account_size`, `default_stop`, `position_closing`, `breakeven_range`, `setups`, `setup_rules`,
  ...). `useJ2Settings.save` (`hooks/useJ2Settings.js:43-55`) sends the whole settings object. Task 13
  seeds by GET, modify `setups`/`setupRules`/`accountSize`, PUT the whole object back.

## §V14: where uct-intelligence lives. **ANSWERED (Task 11)**

- `$UCT_INTEL_PATH`: unset (process, User and Machine scope all empty).
- `external/uct-intelligence`: the submodule directory exists in the worktree but is EMPTY (not
  initialised); `uct_intelligence/api.py` is absent.
- `C:\Users\Patrick\uct-intelligence\uct_intelligence\api.py`: present (183,160 B), the only one.

Task 11's rail looks in that order and, on this box, finds the third.

## Which later tasks these answers change

| item | task | change |
|---|---|---|
| V2 | 13 | compare typing against `ty9-quiet-marker/q1` (6.85 / 6.77 / 9.73), same flags; say so in the PR body |
| V3 | 6 | the chunk-membership reading is owed before Task 6 spends bytes |
| V4 | 11 (1A) | `regimeAsOf` must come from the wire date, as `_regime_fields` does; `get_current_regime().asOf` is always `None` |
| V4 | 3 | a null breadth payload is "wire unavailable"; never retry `get_breadth` inside a create |
| V5 | 3 | cache-only read by the brief's rule, against IR-S5: integrator decision; handle a `JSONResponse` return |
| V6 | 5 | `detail["trade"]["positionId"]`; `tradeRef` is top-level |
| V8 | 4, 9 | Board read-only when grouped by a non-`user_set` property; Task 9's sentence names the picker steps |
