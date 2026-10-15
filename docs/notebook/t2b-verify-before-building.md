# Tier 2 part B: verify before building (Task 1)

Base `204234469b` on branch `notebook-t2b-followup` (since rebased onto origin/master `4649e2d03e`, see V1). Run 2026-10-15, 12:52 to
13:17 ET (a Thursday, a trading day). The last probe stamp is 13:17 ET: the keyless V2-V4 smoke was re-run then, after the sampling change below; the first set of
probes ended at 12:59 ET, and the earlier smoke output is in git history at `9af0726107`.
Raw output for every probe is committed BEFORE this document: `docs/notebook/evidence/t2b-verify-20261015/` in commits `9af0726107` and `792dd1d297`; the post-merge walk
for PR #330 is its own commit `50b0c273c1`. A line the document quotes is quoted from the base tree. A `file:line` is a dated claim like any other: it was true
on `204234469b`.

Setup, verified rather than created (F11): the worktree `C:\Users\Patrick\uct-worktrees\notebook-t2b` and branch exist; `.uct-session-owner` reads `session: 61625d99-f8db-4269-a728-231c08d3da11` /
`created: 2026-10-15`; the `app/node_modules` junction target `_nb-shared-install\node_modules` holds **377** entries (`ls -A | wc -l`, re-read after the rebase and still 377). The spec and both plans were
read by absolute path from `notebook-presets-spec` and not copied.

Nothing under `C:\data` was written. The protection is the census pin: each of the V2-V4, V6 and V18 probes calls `hub_sandbox_boot.apply_sandbox_env` (the census pins and the shared-root
tripwire) before importing any `api.*` module (read the scripts in `probes/`); the V2-V4 probe also prints the sandbox `auth_db_path` in its HEAD line, and the V16 probe opens no data path.
There is no pre-run capture of `C:\data\auth.db`, so no before/after comparison is claimed. A read-only stat taken after the run is in `c-data-auth-db-stat-end-state.txt`
(labelled "end state, taken after the run, no pre-run capture": mtime 2026-10-02 23:58:04 CT, older than every probe, which is consistent with no write and is not proof of one).
No provider key was read, printed or written.

## Summary

| | |
|---|---|
| Measured | V6, V10, V11, V14, V16, V18, and the base reds |
| Read from code and confirmed | V1, V5, V7, V8, V9, V12, V13, V15, V17 |
| NOT YET MEASURED | V2 entire; V3's bar half and its `reaction_none` count; V4's three live readings (which leg answered, the symbols' timing, Finnhub's `hour` values). The reason is in "The three measured items" |
| Differs from the plan text | V10 (the composed fixture is not the tool's; re-confirms pre-flight F7), V12 (the guard IS needed), V15 (row 66 is free and skipped; 67 and 68 are still free). V9 is confirmed, none: the conditional step is moot |
| Base reds | none real. One load-sensitive timeout, green alone |

Rulings the controller owes before Task 2 is dispatched are listed at the end ("For the controller").

## Base reds (Step 2), "pre-existing at 204234469b"

* Vitest, the six named files, run while a pytest run shared the box: `Test Files 1 failed | 5 passed (6)`, `Tests 1 failed | 119 passed
  (120)`. The one red is `src/pages/command/keyListenerCensus.test.js > TERM-063 ... > NON-VACUITY: it walks the whole tree, parses
  every file, and finds the registry`, first line `Error: Test timed out in 15000ms.` Re-run alone: `Tests 7 passed (7)`, that test
  in 5,012 ms. So it is load-sensitive, not a red of the base. Raw: `base-reds/vitest-six-files.log`,
  `base-reds/vitest-keyListenerCensus-alone.log`.
* Pytest, the seven named files: `183 passed, 11009 warnings in 113.99s`, exit 0. Raw: `base-reds/pytest-seven-files.log`.

## V1. Base, ancestry, the flag rows Part A added

* `git merge-base --is-ancestor 204234469b origin/master` exits 0 (`v1-ancestry.txt`): the base IS an ancestor of master, and Part A is merged. PR #331
  `Merge pull request #331 from unchartedterritory5995-cyber/notebook-t2a-assists` is `2019ec0202`.
* origin/master was `4649e2d03e` (#332, a screener merge), 48 commits ahead of the base when measured. Of the 147 files those commits change,
  four sit in the Notebook area: `MarketContextEmbed.jsx`, `WidgetEmbedView.module.css`, `blocks/PrepCapture.jsx` (all from #330, merge `70beb043b5`) and
  `lib/formula/offlineNeverStoresComputed.test.js`. None is in the plan's File map (a grep of the plan for those four names returns 0).
  **The rebase is DONE** (controller ruling): the branch now sits on `4649e2d03e`, and this task's commits are `50b0c273c1` (the #330 walk), `9af0726107` (raw) and `e26cddfae8` (this doc, before this amendment).
  Every `file:line` in this document was read on the pre-rebase base `204234469b`; the rebase brought in none of the cited Notebook files except as listed above.
* `git show --stat 6ddba86694` (the Part A switch commit, 9 files, 47 insertions): `api/routers/auth.py` (+1:
  `"NOTEBOOK_SMART_CHIPS_ENABLED": False,  # enablement (Tier 2 part A: alert + screenshot chips)` at `auth.py:266`), `J/lib/offline/notebookFlags.js` (+1),
  `J/lib/smartChipsFlag.js` (+11), its test (+15), `docs/feature_flags.json` (+10), `tests/test_notebook_flag_parse.py` (+3),
  `tests/test_notebook_flags.py` (+2), `tools/notebook_contract_fixtures.py` (+2), `tools/notebook_fin_walk.py` (+2). Task 2 mirrors exactly this shape.

## V2 (measured). Does `earnings_intel` hold the just-reported quarter by 16:45 ET, and by 18:00 ET?

NOT YET MEASURED. Two independent blockers, and neither is the clock:

1. The probe needs `FINNHUB_API_KEY`, `FMP_API_KEY` and `MASSIVE_API_KEY` in its environment. This task was told that provider keys come
   only through `with_model_keys.py`; that helper (`<scratch>/fin/with_model_keys.py`) forwards exactly `("ANTHROPIC_API_KEY", "OPENAI_API_KEY")`
   and says "No other production variable is forwarded". None of the three data-provider names is in this shell's environment. The plan's
   own method (`load_dotenv(repo + "/.env")`) was not used: the worktree has no `.env`, and reading the main checkout's would be a second,
   unsanctioned channel.
2. At 12:59 ET it is also before the first gate (16:45 ET).

Ruling (controller): V2, V3's bar half and V4's live readings are POST-ARMING observations, recorded in the arming packet. No agent obtains provider keys. The commands below are kept for whoever takes them then.

What was run instead, and is NOT a measurement: `t2b_v2_probe.py ... all` with no keys (`v2-v3-v4-keyless-smoke.txt`). Its HEAD line (line 2 of the file; line 1 is the sandbox's model-key banner) says
`"keys_present": {"FINNHUB_API_KEY": false, "FMP_API_KEY": false, "MASSIVE_API_KEY": false}, "MEASUREMENT_VALID": false`, so nothing in that file is a reading. It proves the harness: the
sandbox pins landed (`"auth_db_path": ...\scratchpad\t2b-v2-data-smoke2\auth.db`), `previous trading day` resolves to `2026-10-14`, and the three sections
print. It also showed one fact worth keeping for Task 7 (see V4).

Exact commands to run later (PowerShell; a Windows path through the Bash tool loses its backslash). The controller supplies the three keys in the
environment of THAT process through whatever channel it sanctions, then:

```powershell
$repo = 'C:\Users\Patrick\uct-worktrees\notebook-t2b'
$ev   = "$repo\docs\notebook\evidence\t2b-verify-1645"        # 'at or after 16:45 ET'; use t2b-verify-1800 after 18:00 ET
New-Item -ItemType Directory -Force -Path $ev | Out-Null
$sbx  = 'C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\61625d99-f8db-4269-a728-231c08d3da11\scratchpad\t2b-v2-data-1645'
python "$repo\docs\notebook\evidence\t2b-verify-20261015\probes\t2b_v2_probe.py" $repo $sbx all *> "$ev\v2-v3-v4.txt"
$code = $LASTEXITCODE; Write-Output "EXIT: $code"; exit $code
```

Read the file's HEAD line (line 2; line 1 is the sandbox model-key banner): `"MEASUREMENT_VALID": true` or the run is void. The reporters sampled are a seeded spread (`random.Random(20261015).sample`), not the alphabetical head, so the reading is not biased toward A-names. The `V2` line carries, per reporter (6 per day, today and the
previous trading day), `newest_reported`, `eps_actual`, `revenue_actual`, `reaction_none`, `reaction_for_day`, `n_quarters`; the answer is "rows with
`newest_reported == day` and an `eps_actual`" over rows, at each time. The same run writes the `V3_BARS` and `V4` lines. Run it again after 18:00 ET.
Per F12 this never blocks the build; it must close before Task 7 (the job's pass times and its ranking read it).

## V3 (measured, code half done). The reaction under four quarters, and today's bar

Code (quoted, base tree):

* `api/services/earnings_reaction.py:59`  `MIN_COMPUTED = 4`
* `api/services/earnings_reaction.py:201-202`  `    if len(moves) < min_computed:` / `        return None`
* `api/services/earnings_intel.py:542`  `reaction = _er.reaction_for(sym, quarters)` and `:560` `"reaction": reaction,`

So `reaction` is `None` for the WHOLE strip when fewer than four moves compute: every event, including the newest, is absent, and the payload
key is present with value `None`. This confirms the plan's reading and Task 6's `reaction_none` handling.

NOT YET MEASURED: how many of Step 4's rows have `reaction_none: true`, and whether `bars_fetch._get_bars_inner(sym, "D", 5)` carries today's
session close at 16:45 ET. Both need the keys in V2 and the wall clock; both are in the `V2` / `V3_BARS` lines of the run above.

## V4 (measured, code half done). The reporters lookup for a past date

Code: `api/services/calendar_alerts.py:124` `def _get_reporters_for_date_with_status(market_date: str) -> tuple[set[str], bool]:` runs
three legs in order and returns at the first non-empty one: (1) the `calendar_weekly` cache's `bmo`/`amc`/`tbd` entries for that day, returned as `(result, True)`;
(2) `:158` `data = fh_get("/calendar/earnings", {"from": market_date, "to": market_date}, timeout=10)`; (3) `:174` `fmp_result, fmp_ok = _fmp_reporters_for_date_with_status(market_date)`.
`ok` is `False` the moment any leg that ran raised or returned a non-2xx or a malformed body, "or was simply unconfigured" counts as OK.

* **Seen in the keyless sandbox, `MEASUREMENT_VALID: false`, so a harness observation and not a reading** (`v2-v3-v4-keyless-smoke.txt`, V4 line): `"reporters_count": 0, "ok": true, "answered_by_cache_leg": false`. With no key
  and an empty cache the lookup answers `(set(), True)`: an unconfigured box and a genuinely quiet day are the same answer. That is the docstring
  at `calendar_alerts.py:124-` saying so ("a genuinely quiet day looks identical to a throttled one from here"), now seen. **Consequence for
  Task 7:** `ok == True` with zero reporters is not evidence that nothing reported. Controller ruling: Task 7 treats an unconfigured reporters lookup as INCONCLUSIVE.
* `earnings_prep._timing_from_calendar_cache(sym, day)` (`earnings_prep.py:219`) reads only the already-built `calendar_weekly` / `calendar_week_<monday>` caches and
  returns `None` for an unbuilt week ("Nothing is built here"). Keyless sandbox: `{}` (no symbols to ask about).
* Finnhub's `hour`: how this repo reads it: `api/routers/calendar.py:977-978`  `hour = (row.get("hour") or "").lower()` /
  `timing = hour if hour in ("bmo", "amc") else "tbd"` (same at `:1207-1208`). So the repo only trusts `bmo` and `amc`; anything else is `tbd`.

NOT YET MEASURED: which leg answers for 2026-10-14 on the live box, the timing the cache gives each reporter, and the actual `hour` values and row keys Finnhub
returns that day. They are the `V4` line of the same keyed run.

## V5. `notes.list_notes(...)` and the shape of a row (confirmed)

* `api/services/journal_two/notes.py:1878` `def list_notes(` takes `user_id` first, then keyword `tag`, `sort`, `limit`, `conn`, `ticker`, `q`, ... (all keyword-only).
* Newest created first: `notes.py:2028` `"created": "created_at DESC",` (the `order_col` map).
* The row (`_row_to_note`, `notes.py:1377-`): `"id": row["id"],`, `"ticker": row["ticker"],`, `"createdAt": row["created_at"],`.
* `createdAt` is UTC with an offset: `notes.py:188-189` `def _now_iso() -> str:` / `return datetime.now(timezone.utc).isoformat()`, so `2026-10-15T17:00:00.123456+00:00`.
* The existing caller, `earnings_prep.py:273-275`: `for n in list_notes(user_id, tag="earnings-prep", sort="created", limit=200):` /
  `sym = str(n.get("ticker") or "").upper()` / `created = str(n.get("createdAt") or "")[:10]`.
  **Caution for Tasks 6 and 9:** `[:10]` of a UTC ISO string is the UTC date, not the ET date; a note made after 20:00 ET (EDT) reads as the next day. Compare in ET (convert first) wherever a follow-up note's date matters.

## V6. `GET /api/alerts` and a private alert written by another process (measured)

* Router: `api/routers/alerts.py:24-30`, `@router.get("/api/alerts")` / `def list_alerts(...)` ... `return get_alerts(limit, user_id=user["id"])`.
* Service: `api/services/alerts.py:322` `def get_alerts(limit: int = 50, user_id: str | None = None) -> list:`; the durable merge is `:372-373`
  `from api.services import alert_durability as _durable` / `legacy_durable = _durable.list_durable_alerts(user_id, limit)`, merged at `:376` `merged += [d for d in legacy_durable if d["id"] not in mine_ids]`, by id.
  `add_alert` (`alerts.py:382`) writes the in-process cache AND `:445-447` `if _durable.should_persist(alert): _durable.record_alert(alert)`. The table lives in `AUTH_DB_PATH`
  (`alert_durability.py:39`).
* Measured, two separate processes on one sandbox auth.db (`v6-alerts-cross-process.txt`): process A `add_alert("notebook_earnings_followup", ..., user_id="probe-user-1")`;
  a brand-new process B (empty cache) `get_alerts(50, user_id="probe-user-1")` returned the row, id `notebook_earnings_followup_1792083636851`, with `data.research_url` intact, and `probe-user-2` got 0 rows.
  So a child's private alert IS served by the server through `list_durable_alerts`. **Task 11's walk can rely on it.**
* Side measurement for Task 7: the alert id is `f"{alert_type}_{int(time.time() * 1000)}"` (`alerts.py:421`, `add_alert`) and `user_alerts.id` is a GLOBAL primary key (`alert_durability.py:49` `id TEXT PRIMARY KEY,`) written `INSERT OR IGNORE`
  (`alert_durability.py:97`). Two members given the same alert type inside one millisecond would lose the second durable copy silently. 200 members delivered one after another: `distinct_ids 200, durable_rows 200, ephemeral_rows 200`, 7.95 ms per call, so a single-threaded
  job cannot collide. It would if the job were ever parallel. Recorded, not a change.

## V7. `finnhub_client.fh_get` (confirmed)

`api/services/finnhub_client.py:212`  `def fh_get(path: str, params: dict, timeout: int | None = None, base_url: str = _FH_V1) -> dict | list | None:`.
Returns parsed JSON or `None` on failure; it returns `None` without a call when the key is unset (`:233-236`), the symbol is junk, the endpoint 403'd within 24 h, the token bucket is spent, or a 429 cooldown is on.
The caller at `calendar_alerts.py:158` is `fh_get("/calendar/earnings", {"from": market_date, "to": market_date}, timeout=10)` and reads `data.get("earningsCalendar", [])`. Seen keyless: the log line `FINNHUB_API_KEY not set - Finnhub call skipped (/calendar/earnings)`.

## V8. `notebook_flags.flag_on(name, default)` reads the environment per call (confirmed)

`api/services/notebook_flags.py:47` `def flag_on(env_name: str, default: bool) -> bool:`; `:54` `raw = os.environ.get(env_name)`; unset, or neither a TRUTHY nor a FALSY spelling, answers `default`. No module-level capture.

## V9. Consumers that assume a block id is a widget id (confirmed, none; the conditional step is moot)

Confirmed, none (Task 3's conditional, "If Task 1 V9 named a client consumer ... add the guard"): V9 names none, so that step is moot.

* `KindSection.jsx:23` `const KNOWN_BLOCKS = new Set(BLOCK_KINDS.map((b) => b.id))`; `:28-29` `if (KNOWN_BLOCKS.has(id)) return blockLabel(id)` / `return WIDGET_REGISTRY[id]?.labels?.header || blockLabel(id)`.
  `reminder` is in `BLOCK_KINDS`, so it takes the first branch and never reaches the registry. Besides, a Reminder composes to an unticked task, not a `widgetEmbed`, so `blockLine` is not asked about it.
* `StyleEditor.jsx:23-24` `const KNOWN = new Set(BLOCK_KINDS.map((k) => k.id))` / `const kindOf = (id) => BLOCK_KINDS.find((k) => k.id === id)`: catalogue only, no registry.
* `blocks/BlockNodeView.jsx:65` `const load = BLOCK_COMPONENTS[attrs.widgetId]`, reached only for a `widgetEmbed` whose `isTraderBlock(...)` (`registry.js:1026-1028`, `WIDGET_REGISTRY[id]?.block === true`) is true. A Reminder is never one.
* `api/services/journal_two/public_note_payload.py:200-212`: the source table is keyed `("widgetEmbed", <widget id>)`; `reminder` is never an embed, so it needs no row.
* `registry.test.js:697-700` (S20) iterates `BLOCK_IDS` (the registry's own list) and looks each up in `BLOCK_KINDS`, not the reverse. A catalogue id with no registry entry does not fail it.
* Two tool consumers read the catalogue by SHAPE, so the Task 3 row must stay as the plan writes it: `tools/notebook_nvda_pass.py:491-503` reads server `BLOCK_KINDS` with `ast.literal_eval` (the new row is a pure literal: OK), and
  `tools/notebook_fin_walk_features.py:94-98` `dict(re.findall(r"id:\s*'(\w+)',\s*label:\s*'([^']*)'", src))` over `journalBlocks.js` (the plan's `id: 'reminder', label: 'Reminder'` are adjacent: OK).

## V10. `tools/notebook_contract_fixtures.py` write mode and which fixtures carry what (confirmed; re-confirms pre-flight F7)

* Header, `tools/notebook_contract_fixtures.py:5-9`: it writes `app/src/pages/journal-2-0/__fixtures__/contract/<name>.json` only. Write mode is `python tools/notebook_contract_fixtures.py`; `--check` exits 1 on a difference; `--list` names them.
  Base: `OK: 261 contract fixtures match the server` (`v10-contract-fixtures-check.log`).
* Carry `blockKinds` (only these two): `journal-styles.list.json`, `journal-styles.list.empty.json` (`grep -l blockKinds`). Served by `api/routers/notebook_journal_styles.py:127` `"blockKinds": [k["id"] for k in js.BLOCK_KINDS]}`.
  **So Task 3 (which adds `reminder` to `BLOCK_KINDS`) changes these two, and they must be regenerated in Task 3, not Task 4.**
* Carry kinds or styles: `note-kinds.*` (list, create, update, delete, mapping-offer), `journal-styles.*` (list, get, default, create, update, preview, restore, delete), `notes.create.kind*`, `notes.create.styled*`, `notes.style-update-plan*`, `notes.apply-style-update*`.
* **Differs:** `lib/__fixtures__/journalStylesComposed.json` is NOT written by the tool (`grep -c journalStylesComposed tools/notebook_contract_fixtures.py` is 0). It is pinned by `tests/test_journal_styles_schema.py` (header lines 5-15) and holds `builtin_<id>` and `builtin_<id>_no_ticker`
  for every built-in style (`for kind in js.BUILTIN_STYLES`, line 132); regenerate with `UCT_WRITE_JOURNAL_STYLES_FIXTURE=1 python -m pytest tests/test_journal_styles_schema.py`. Task 4 adds a built-in style, so Task 4 owns that regeneration, and V10's list must drop it from "the tool's".

## V11. Editor commands (measured)

On `buildExtensions()` in a real `Editor` under vitest/jsdom (`probes/v11-tiptap-commands.log`, `probes/v11.t2bprobe.test.js.txt` is the throwaway test; it was removed from `app/src`):
`"splitBlock":"function","splitListItem":"function","toggleTaskList":"function","isActiveFn":"function"`; `isActive('taskItem')` is `false` before and `true` after `toggleTaskList()`;
`editor.commands.splitListItem('taskItem')` returned `true`; the schema has `taskItem` and `dateMention`. @tiptap/core and extension-list are 3.23.6. All four names Task 10 uses exist on this roster.

## V12. `lazyDialog` / `lazyChunk` and a failed chunk fetch (confirmed; the plan's conditional DOES apply)

* `app/src/pages/journal-2-0/tabs/NotebookTab.jsx:111` `function lazyDialog(load, label) {` ... `:118` `<Suspense fallback={null}>`. No error boundary of its own.
* `app/src/pages/journal-2-0/lib/lazyChunk.js:80-82` `export default function lazyChunk(load, waitMs = RETRY_WAIT_MS) {` / `return lazyWithRetry(() => importWithOneRetry(load, waitMs))`: one in-place retry,
  then `utils/lazyWithRetry.js:46` `window.location.reload()` on the first chunk error of a session, and `:52` `throw err` after that.
* So a failed chunk does NOT render nothing: the first time the page reloads, afterwards the error is thrown past `lazyDialog` to the nearest boundary. **Task 9's conditional (line 2313 of the plan) applies:** wrap the element in the guard Part A used (`git show c57a084a08 -- .../NoteEditorPage.jsx`), with a test that a rejected import renders nothing. `lazyLeaf` (`lazyChunk.js:96`) is the no-reload form for a leaf inside a working note.
* Path note: the plan writes `NotebookTab.jsx:94-125`; the file is `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` (lines match).

## V13. Adding a symbol to a member's watchlist (confirmed)

`api/routers/watchlists.py:406` `@router.post("/api/watchlists")` with body `WatchlistCreate {name: str, description: Optional[str] = "", is_public: Optional[bool] = False}` returns the list (with its id);
`:502` `@router.post("/api/watchlists/{wl_id}/items")` with body `WatchlistItem {sym: str, notes: Optional[str] = ""}` (`:54-56`) adds it; 404 `Watchlist not found` for another member's list.
The job reads them through `earnings_prep._member_sets` -> `calendar_personalization.get_user_ticker_sets` (`MEMBER_SOURCES = ("positions", "watchlist", "flagged")`, `earnings_prep.py:58`).

## V14. First-open closure (measured)

`npm run build` exit 0 (`v14-npm-build.log`); `python tools/notebook_perf_budgets.py --dist app/dist`:
`bytes.notebook_first_open: 2,251,768 B across 61 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)` / `VERDICT: PASS` (`v14-perf-budgets.txt`). Exactly the expected 2,251,768 B. Task 11's ceiling 2,253,816 = +2,048 B; the file's budget has 9,025 B of room.

## V15. Door-audit rows (confirmed; differs on the number)

`tools/notebook_door_audit_doors.json` is a list of 28 rows over 24 distinct `audit_row` values: 11, 15, 23, 24, 26, 29, 32, 33, 34, 35, 39, 40, 41, 42, 46, 53, 54, 55, 56, 57, 59, 63, 64, 65.
`"flag": null` is accepted and already used by 9 rows (11, 24 x2, 26 x2, 33, 34, 35, 46); the tool's default is `"flag": None` (`tools/notebook_door_audit.py:460`) and `:648` reads `flag = row.get("flag")` before using it.
**Differs:** the plan says "expected 67" is the next free; the highest is 65, so **66 is free and would be skipped; 67 and 68 are still free** (the plan's hard-coded "67 and 68" in Task 11 are not wrong, only gappy). F18 says take the next unused numbers from the file at execution time; the controller has ruled Task 11 uses 66 and 67.

## V16. `session_calendar` (measured)

Artifact: `probes/t2b_v16_probe.py` (no network, no key, no data path) and its output `v16-session-calendar.txt`, run 2026-10-15 about 13:15 ET.

`api/services/session_calendar.py:154` `def horizon(cal: CalendarData = _CAL) -> date:` returns **2028-12-31**; `coverage_start` is 2000-01-01; version `2026-09-29.1`. `covers(2026-10-14)` and `covers(2027-12-31)` are both true.
Weekday holidays: **Thanksgiving Day 2026-11-26** (Thursday), Christmas Day 2026-12-25; 2027 has ten (the first is New Year's Day 2027-01-01, the last Christmas Day (observed) 2027-12-24). Task 3's holiday test has a real November 2026 date to use.

## V17. The walk's two seams (confirmed)

* `earnings_prep.py:181` `def _sandbox_window() -> tuple[dict[str, str], dict[str, str], bool, str]:`; `:184` `with open(path, encoding="utf-8") as fh:` - the file is opened on every call, no cache. It is live only when
  `sandbox_calendar_active()` (`:160-168`): the env `NOTEBOOK_EARNINGS_PREP_SANDBOX_CALENDAR` (`:75`) is set, `on_production()` is false, and `sys.modules["conftest"]` carries `SHARED_DATA_ENV_PINS` (a census-pinned child).
* `tools/notebook_w13c_walk.py:182` `snap.put(earnings_intel._KIND, "NVDA", spec["intel"], 7 * 86400)` with `earnings_intel.py:91` `_KIND = "earnings_intel_v10"`; `fundamentals_snapshot_store.put(kind, ticker, payload, ttl, now=None)` (`:70`).

## V18. `get_user_plan` and `is_paid_user` (measured)

`api/middleware/auth_middleware.py:9` `from api.services.auth_service import validate_session, get_user_plan` (so `authmw.get_user_plan` resolves; it is defined at `auth_service.py:304`) and `:92` `def is_paid_user(user: dict) -> bool:` (-> `trial.is_paid_or_trial`).
`api/routers/journal_two.py:3576` `planned = user if "plan" in user else {**user, "plan": authmw.get_user_plan(user["id"])}`. Real `users` rows plus `plan` (`v18-plan-and-paid.txt`):
free member, account older than the trial: plan `free`, `is_paid_user` false; comped member: plan `pro`, true; admin: plan `free`, role `admin`, true; the free row with NO `plan` key: false; `PAID_PLANS` = lifetime, premium, pro.
**Note for Task 7's `_paid`:** `is_paid_user` is also true for a free member inside the account-age trial (`trial.py:30` `TRIAL_DAYS = 7`, and accounts created before the no-card cutoff), because `is_paid_or_trial` ends in `is_account_in_trial`. A test that makes a free user must use an old `created_at` (this probe did) or it measures the trial.

## The three measured items, and why two blockers are not the clock

F12 asks that V2 and V4 stop being wall-clock gates. What can be measured without a key and without 16:45 ET was measured (V6, V18, V10, V11, V14, V16 and the keyless shape of V2-V4). The remainder needs two things the
controller owns: a sanctioned way to put `FINNHUB_API_KEY`, `FMP_API_KEY`, `MASSIVE_API_KEY` into a child's environment, and a moment (today 16:45 ET and 18:00 ET are still ahead; the next trading day is Friday 2026-10-16). It is one command per time slot.

## For the controller

1. **RULED:** V2, V3-bars and V4-live are post-arming observations recorded in the arming packet; no agent obtains provider keys (`with_model_keys.py` does not carry FMP/Finnhub/Massive).
2. **V12 -> Task 9:** the `lazyDialog` guard IS needed (a failed chunk reloads once, then throws). Not a "none".
3. **V9 -> Task 3:** no client consumer breaks on `reminder`; the V9 conditional guard step is moot. Keep the row a pure literal with `id` and `label` adjacent (two tools read it by shape).
4. **V10 -> Tasks 3 and 4 (F7):** Task 3 regenerates `journal-styles.list.json` and `.list.empty.json` and runs `tests/test_notebook_contract_fixtures.py`; Task 4 regenerates `note-kinds.list.json`, `journal-styles.list.json`, and the composed fixture by `UCT_WRITE_JOURNAL_STYLES_FIXTURE=1 ... tests/test_journal_styles_schema.py`.
5. **V15 -> Task 11 (F18):** door-audit rows 66 and 67 (ruled), read from the file at execution time; 67 and 68 are still free, only 66 is skipped by the plan's numbers.
6. **V1:** Part A is merged; the base is an ancestor of master. The rebase onto `4649e2d03e` is DONE (48 commits, four Notebook-area files from #330, no overlap with this plan's File map).
7. **V4 -> Task 7:** `(set(), True)` is also what an unconfigured box answers (seen in the keyless smoke, `MEASUREMENT_VALID: false`, so a harness observation). Ruled: Task 7 treats an unconfigured reporters lookup as INCONCLUSIVE.
8. **V5 -> Tasks 6, 9:** `createdAt` is UTC; do not compare its `[:10]` to an ET day.

## Task 4 census (the ONE-FACT-IN-TWO-FILES pairs that list built-in kinds or styles)

Run 2026-10-15 on `c1be173900` plus Task 4's edits, before the kind was added. Raw outputs: grep `git grep -n "watchlist_note\|post_trade_review" -- api app/src tools tests`
returned **52 lines in 17 files**; the AST walk (lists, tuples, sets and dicts holding at least three of the eight built-in kind ids as string
literals, over `api`, `tools`, `tests` and `scripts`) returned **one** hit, `api/services/journal_two/journal_styles.py:132`, which is the `BUILTIN_STYLES` dict itself.

| Pair | Files | Pinned by | Result |
|---|---|---|---|
| built-in kinds | `note_kinds.py:42-52` and `lib/noteKinds.js:8-18` | `tests/test_note_kinds.py:44-45` (through Node) | Confirmed. Both gain `earnings_followup` right after `earnings`. |
| a style per kind | `journal_styles.BUILTIN_STYLES` keys and `note_kinds.BUILTIN_KIND_IDS` | `tests/test_journal_styles_store.py:65` | Confirmed. The new style sits right after `earnings`, so the dict order matches the kind order. |
| Kind of note options | `note_properties.py:114`, derived from `BUILTIN_NOTE_KINDS` | none before; Task 4 adds `test_the_kind_of_note_property_lists_the_new_kind` | Confirmed derived, no edit. (`note_properties.py:106` `watchlist_note` is the separate `builtin:research_type` option list, mapped to kinds by `RESEARCH_TYPE_TO_KIND`; unchanged.) |
| contract fixtures | `note-kinds.list.json`, `journal-styles.list.json`, `journal-styles.list.empty.json` | `tests/test_notebook_contract_fixtures.py` | Regenerated with `python tools/notebook_contract_fixtures.py`; `--check` prints `OK: 261 contract fixtures match the server`. |
| composed fixture | `lib/__fixtures__/journalStylesComposed.json` | `tests/test_journal_styles_schema.py` | NOT the tool's (F7, V10). Regenerated with `UCT_WRITE_JOURNAL_STYLES_FIXTURE=1 python -m pytest tests/test_journal_styles_schema.py`: 180 lines added, none removed (the two new keys `builtin_earnings_followup` and `builtin_earnings_followup_no_ticker`). |

Found beyond the plan's table, each a test literal of the same fact, fixed in this task by deriving from the list:

* `tests/test_note_kinds.py:124` `ids[:8]` (the plan named it) now `ids[:len(nk.BUILTIN_NOTE_KINDS)]`.
* `tests/test_notebook_journal_styles_router.py:86` `assert len(listing["kinds"]) == 8`. The kind-id grep cannot find it (it names no kind); a search for the literal count did.
  Now `len(nk.BUILTIN_NOTE_KINDS)`.
* `tests/test_notebook_journal_styles_router.py:82-84` pinned `blockKinds` without `reminder`; it was already red at `c1be173900` (Task 3 changed `BLOCK_KINDS` and missed this list). `reminder` appended.

Looked at and left alone, not pairs of this fact: the voice TOOL named `post_trade_review` (`voice_tool_impls.py:1090-3068`, `voice_briefings.py:202`, `voice_agents.py:251`,
`routers/voice.py:948`, `tools/voice_tool_audit.py:160-161`, `tests/test_voice_tools.py:234`), a name collision with the kind id and nothing else; the four client tests that build their kind lists from `BUILTIN_NOTE_KINDS`
(`NotebookTab.kindPicker`, `NotebookTab.listCaret`, `KindSection`, `NoteMenuActions.saveAsStyle`), which derive and carry no literal; and tests that use `builtin:watchlist_note` as a sample style id.
