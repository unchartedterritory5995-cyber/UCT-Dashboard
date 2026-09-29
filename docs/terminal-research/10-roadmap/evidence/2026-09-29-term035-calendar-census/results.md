# TERM-035 calendar census: results

Base: `337507afd` (worktree branch `worktree-agent-a87761ef64fc83ee7`). Measured 2026-09-28.

This records what TERM-035 built, the holiday and half-day lists it found, and whether
those lists agree. It lists the remaining scattered users so each can be migrated one
module at a time. That migration is not part of this ticket.

## What was built

| Piece | Path |
|---|---|
| The dataset (the one file both runtimes read) | `app/src/lib/marketClock/market_calendar.json` |
| Python authority | `api/services/session_calendar.py` |
| JS authority | `app/src/lib/marketClock/sessionCalendar.js` |
| Shared fixture (read by pytest and by vitest) | `tests/fixtures/market_calendar_cases.json` |
| Python tests, including the horizon rail | `tests/test_session_calendar.py` |
| JS tests | `app/src/lib/marketClock/sessionCalendar.test.js` |

- **Version** `2026-09-28.1`. **Coverage** `2025-01-01` to **horizon `2028-12-31`**.
- **API on both sides:** `session_at(ts)` / `sessionAt(ts)` returns `'pre' | 'rth' | 'post' | 'closed'`.
  Also `is_trading_day(d)` / `isTradingDay(d)`, `close_time(d)` / `closeTime(d)` (13:00 ET on a
  half-day), and `horizon()`. `covers`, `is_half_day` and `holiday_name` are helpers.
- **Boundaries (ET, DST-aware):** pre-market starts 04:00. RTH is 09:30 to 16:00, or to 13:00 on a
  half-day. Post-market runs to 20:00 on every trading day, half-days included.
  - This half-day post-market end follows the convention two shipped modules already use:
    `marketClock.js` (`EXT_END_MIN`) and `voice_temporal_awareness._session_state`.
  - `nyse_calendar.EARLY_EXTENDED_CLOSE_HOUR = 17` is not followed. Its own comment calls it an
    unconfirmed vendor-bar hypothesis that "nothing member-facing reads".
- **Why the JSON lives under `app/src`:** Vite's dev server refuses to import from outside `app/`.
  Vite 7.3.1 sets `server.fs.allow` to the package root, because `ROOT_FILES` is only
  `pnpm-workspace.yaml` and `lerna.json`, and neither exists here. The Python runtime image copies
  the whole tree (`Dockerfile.web`: `COPY . /app`), so `app/src` is the one path both runtimes can
  read without a config change.

## Source of the dates

The dates were derived with `pandas_market_calendars` 5.4.0 (NYSE) and `exchange_calendars`
4.13.2 (XNYS). Both were installed into a scratch `--target` directory, so the project
environment is unchanged. **The two libraries agree on every holiday and every early close from
2025 through 2029.**

The 2025 to 2027 rows are also held exactly equal to `api/services/nyse_calendar.py` by
`test_dataset_equals_nyse_calendar_py_*`. The 2026 and 2027 rows are held equal to
`app/src/lib/marketClock/nyseCalendar.js` by a vitest case.

The horizon stops at 2028-12-31 because that is the last year NYSE has published. 2029 is
computable from the rules, but it is not an exchange publication yet.

The only dataset year no in-repo list had was 2028:

- **2028 closures:** 01-17, 02-21, 04-14, 05-29, 06-19, 07-04, 09-04, 11-23, 12-25.
  - There is no New Year's closure. Jan 1 2028 is a Saturday, and NYSE does not observe it on
    Friday Dec 31, 2027.
- **2028 early closes (13:00):** 07-03 and 11-24. Christmas Eve 2028 is a Sunday.

## The existing lists, and whether they agree

"Truth" below means the derived dataset above.

| List | Years | Agrees with truth? |
|---|---|---|
| `api/services/nyse_calendar.py` `NYSE_HOLIDAYS_YYYYMMDD` / `NYSE_EARLY_CLOSES_YYYYMMDD`. Re-exported by `bars_fetch` and `liveflow_monitor`. | 2025-2027 | **Yes, every date** (railed) |
| `app/src/lib/marketClock/nyseCalendar.js` `NYSE_HOLIDAYS_20xx` / `NYSE_EARLY_CLOSES_20xx` | 2026-2027 | **Yes, every date** (railed; `tests/test_nyse_calendar_parity.py` already railed it against the Python list) |
| `api/services/voice_temporal_awareness.py` `_NYSE_HOLIDAYS_2026/2027` (holidays typed in the file; early closes are taken from `liveflow_monitor`) | 2026-2027 | **Yes, on dates.** Session convention differs (see below). |
| `tools/full_chart_diagnostic.py` `_NYSE_HOLIDAYS` | 2025-2026 | **No.** It is **missing `2025-01-09`**, the National Day of Mourning for President Carter, a full NYSE closure. It also has no 2027 or later dates. |

### Disagreements, by date

- **`2025-01-09`:** listed as closed in `nyse_calendar.py`, in the new dataset, and by both
  libraries. **Missing from `tools/full_chart_diagnostic.py`,** which treats it as a trading day.
- There are no other date-level disagreements in the years the lists share.

### Disagreements in the session model (not in the dates)

- **`voice_temporal_awareness._session_state`:** anything before 09:30 ET on a trading day is
  `premarket`. There is no 04:00 floor, so 02:00 ET reads as pre-market. The authority returns
  `closed` for that time.
- **`tools/full_chart_diagnostic.py`:** `ET = timezone(timedelta(hours=-4))` is a fixed EDT offset,
  so it is an hour wrong from November through March. This is the DST defect class that fixture
  rows tagged `dst` exist to catch.
- **`liveflow_monitor.session_window`:** the alert session is 09:35 to 16:05, or to 13:00 on a
  half-day. This is a deliberate alerting window, not an RTH definition. It should be migrated as
  "RTH plus a grace period", not replaced.

## The remaining scattered users, for per-module follow-up

Each module needs its own change and its own parity assertion, per the ticket.

### 1. The two existing lists (migrate first) — ✅ DONE 2026-09-28

✅ **Done in "Follow-up #1" at the end of this file.** Both lists now derive from the dataset. The
text below is the plan as it was written, kept for the record.

The fastest route to one authority is to make these two lists read the JSON instead of their own
literals. Every other user reads one of them.

- **`api/services/nyse_calendar.py`.** Load the frozensets from `market_calendar.json` and keep the
  names, so the identity rail in `test_nyse_calendar_parity.py` still holds.
  - Python readers today (21, from `git grep`, not counting the file itself): `bars_fetch`, `liveflow_monitor`, `ast_interpret`,
    `barspack`, `breadth_history_recon`, `breadth_session`, `calendar_week_poster`,
    `catalyst/engine`, `discord_index_close`, `discord_render/freshness`, `flow_card_ops`,
    `flow_gap_autofill`, `indicator_compute`, `massive`, `screener/scan_evaluator`,
    `voice_temporal_awareness`, `wisdom/core/timeutil`, `routers/bars`, `routers/market_calendar`,
    `tools/pre_push_guard`, and `tools/visual_conformance/append_barstate_timeline`.
- **`app/src/lib/marketClock/nyseCalendar.js`.** Build `COVERED_YEARS`, `NYSE_HOLIDAYS_20xx` and
  `NYSE_EARLY_CLOSES_20xx` from the JSON. JS readers today: `marketClock.js`, `useMarketOpen.js`,
  `sessionModel.js`, `sessionStale.js`, `FreshnessBadge.jsx`, `freshnessAge.js`, `extSession.js`
  and `marketSession.js`.
  - ⚠️ Doing this adds 2025 and 2028 to client coverage. **Three existing tests use 2028 as their
    out-of-coverage probe** and will need 2029 instead:
    - `marketClock.test.js:146`
    - `extSession.test.js:114`
    - `marketSession.dailypaint.test.js:154`
  - ⚠️ `tests/test_nyse_calendar_parity.py` parses `nyseCalendar.js`'s date literals with a regex.
    Once the file derives from the JSON, that parser finds nothing. The test becomes "both load the
    same JSON" and should be rewritten, not deleted.

### 2. Other typed lists

- **`api/services/voice_temporal_awareness.py`** `_NYSE_HOLIDAYS_2026/2027`. This is a third typed
  holiday list. It covers no 2028 dates, so this module stops recognising holidays on 2028-01-01.
- **`tools/full_chart_diagnostic.py`** `_NYSE_HOLIDAYS`. It is missing 2025-01-09, stops at 2026,
  and uses a fixed-EDT offset. This is an operator tool, not member-facing.

### 3. Modules that ignore holidays, or read the network copy

- **`app/src/pages/dashboard/useSessionState.js`** takes its holidays from
  `/api/market-calendar`. Its own comment calls `resolveSession` "holiday-blind".
  - That route serves `bars_fetch`'s set, so full closures only and no half-days.
  - Its `covers_through` is derived from the last holiday year, and today reads `2027-12-31`.
- **`app/src/pages/dashboard/TheWeek.jsx`** and **`ZoneRead.jsx`.** Their own comments call them
  holiday-naive.
- **`app/src/components/chart/engine/objectRenderState.js`** documents holidays as "unknowable"
  for projections. It could read the authority instead.
- **`app/src/utils/marketSession.js`** / **`extSession.js`** read `nyseCalendar.js`, so they are
  covered by migrating item 1.
- **`api/live_massive_router.py`** says in its own docstring "No holiday calendar". It is
  partner-owned, so do not edit it without coordinating with Ravi.
- **`tools/alert_corpus_extend.py`** hard-codes `2025-11-28` as a half-day inside a check, which is
  correct.

### 4. Publishing the horizon

✅ Since follow-up #1, `covers_through` reads `2028-12-31` (measured from
`api.routers.market_calendar._COVERS_THROUGH`). The paragraphs below are the plan as written.

`GET /api/market-calendar` already publishes `covers_through`, but from `bars_fetch`'s list, so
today it reads `2027-12-31`. Once `nyse_calendar.py` derives from the JSON (item 1), that field
reads `2028-12-31` with no router change. That is the moment the horizon is published through a
live payload.

Until then, the new module logs the horizon at import. Nothing in production imports that module
yet. The router was deliberately not edited: it is one of the scattered users, and an unguarded
import of a file-reading module in a router is not trivially safe.

⚠️ There is a tension with the router's own docstring, recorded here rather than resolved. That
docstring argues against a rail that "goes red purely because time passed". TERM-035 asks for
exactly that rail, and it is built as `test_horizon_rail_the_dataset_covers_min_months_beyond_today`
with `MIN_HORIZON_MONTHS = 12`. With the horizon at 2028-12-31, the rail first goes red on
**2028-01-01**. That leaves about 15 months to add 2029, which NYSE normally publishes well before
then.

## Test totals (the lane's own files)

- `python -m pytest tests/test_session_calendar.py -q -p no:cacheprovider` gave
  **`108 passed, 1089 warnings`**.
- `cd app && npx vitest run src/lib/marketClock/sessionCalendar.test.js` gave
  **`Tests  95 passed (95)`**.

## Mutation proofs

Each file was backed up to a lane-unique scratch file (`mut_t035_<tag>.bak`) and mutated. The
named suite was then run. Finally the file was restored, and the restored bytes were verified
against `git cat-file blob HEAD:<path>`. `git checkout` was never used.

| Mutation | Python | vitest | Restored = HEAD |
|---|---|---|---|
| Control (unmutated) | 108 passed | 95 passed | n/a |
| **(a)** shrink horizon to 2027-08-28 (11 months out; rows after it dropped) | **18 failed**, including `test_horizon_rail_the_dataset_covers_min_months_beyond_today` | n/a (the rail is on the Python side) | True |
| **(b)** remove half-day 2026-11-27 | **6 failed**: 3 fixture session rows, 1 fixture day row, the `nyse_calendar.py` parity row, 1 helper | **6 failed**: the same 4 fixture rows, the `nyseCalendar.js` parity row, 1 helper | True |
| **(c-py)** `ET = ZoneInfo("Etc/GMT+5")` (DST removed) | **19 failed** (the EDT-season rows of the DST, regular and half-day fixtures) | n/a | True |
| **(c-js)** `Intl` `timeZone: 'Etc/GMT+5'` | n/a | **19 failed**, the same 19 rows | True |

The in-test control `test_horizon_rail_control_goes_red_on_a_dataset_expiring_inside_the_window`
injects a "today" 11 months before the horizon. It proves the rail's own assertion can fail on
every run, not only when someone mutates the dataset.

## Item 6: the `sessionModel.js` / `useMarketOpen` migration was not done

This was a deliberate decision.

- Both files derive from `marketClock.js`, which reads `nyseCalendar.js`. Four other client modules
  read the same layer: `sessionStale.js`, `FreshnessBadge.jsx`, `freshnessAge.js`, and
  `sessionModel.nextOpenHint` through `marketClock.nextBoundary`.
- Moving only the hook onto the new module would split it from those readers for every date where
  the two datasets differ. That is all of 2028. The result would be a second client authority, which
  is the DOC-2 defect this ticket exists to remove.
- The behaviour-preserving single point of migration is `nyseCalendar.js` (item 1 above), one layer
  down. That file is outside this lane's scope.
- The parity the migration will rely on is already proved. `sessionCalendar.test.js` asserts that
  `marketClock.sessionState` agrees with every shared-fixture row inside its own coverage (at least
  40 rows), and that `nyseCalendar.js` equals the dataset on 2026 and 2027.

## Follow-up #1: the two existing lists now derive from the dataset — ✅ DONE 2026-09-28

Base `76bbbe126`. One change, both runtimes.

### What now derives from `market_calendar.json`

- **Client.** `app/src/lib/marketClock/nyseCalendar.js` types no date. It imports `HOLIDAY_ROWS`,
  `EARLY_CLOSE_ROWS`, `COVERAGE_START` and `horizon()` from `sessionCalendar.js` (new exports) and
  builds `COVERED_YEARS` (every whole year in coverage: **2025-2028**, was 2026-2027), the per-year
  tables, `hasCoverage`, `holidayOn` and `earlyCloseOn`. The exported names and shapes are unchanged
  (`NYSE_HOLIDAYS_2026/2027` and `NYSE_EARLY_CLOSES_2026/2027` are now views into the derived tables;
  `NYSE_CALENDAR_BY_YEAR` is new). So `marketClock.js` and everything behind it (`useMarketOpen`,
  `sessionModel`/`nextOpenHint`, `sessionStale`, `FreshnessBadge`, `freshnessAge`, `extSession`,
  `marketSession`) is untouched and now reads the dataset.
  - `sessionCalendar.js` is reachable through that import, so its `AWAITING_A_DECISION` entry and
    `PARKING_EXPIRES` row were removed from `reachable.test.js` (a tombstone comment records it).
- **Server.** `api/services/nyse_calendar.py` builds `NYSE_HOLIDAYS_YYYYMMDD` and
  `NYSE_EARLY_CLOSES_YYYYMMDD` from `session_calendar.calendar()` (new accessor for the one parsed
  copy). `bars_fetch` and `liveflow_monitor` still re-export the same objects (identity rail holds),
  so every reader gains 2028, and `GET /api/market-calendar`'s `covers_through` is `2028-12-31`.
  - The leaf stays a leaf: `session_calendar.py` is stdlib-only, and
    `test_nyse_calendar_parity.py` now rails that (`nyse_calendar` may import only
    `session_calendar` from `api`, `session_calendar` imports nothing from `api`).

### Behaviour for 2025-2027 — measured, not assumed

- **Server: unchanged.** The derived sets, restricted to years ≤ 2027, equal the literals in
  `git show 76bbbe126:api/services/nyse_calendar.py` exactly (31 closures, 6 half-days); the only
  additions are the 9 closures and 2 half-days of 2028.
- **Client 2026-2027: unchanged.** A one-off vitest (deleted after the run) imported the base
  commit's `nyseCalendar.js` beside the new one: the four named tables deep-equal, and `holidayOn`
  / `earlyCloseOn` agree on all 730 days of 2026-2027.
- **Client 2025: CHANGED, deliberately.** 2025 was outside client coverage and degraded to
  weekday-only; it is now covered, so 2025 holidays read as closed and 2025 half-days close at 13:00
  in the browser. Every 2025 date agrees with the server list that was already live. 2028 is the
  same change one year the other way.

### Tests changed

- The three "2028 is out of coverage" probes named above now use **2030**, each with a
  `hasCoverage(2030) === false` precondition so the probe announces itself if coverage ever reaches
  it: `marketClock.test.js` (Fri 2030-01-11), `extSession.test.js` (Tue 2030-01-08),
  `marketSession.dailypaint.test.js` (MLK Day 2030-01-21).
- ⚠️ **A fourth probe this census missed:** `extSession.test.js` used **Christmas 2025** as "a real
  holiday outside coverage". It moved to Christmas **2024** (before `coverage_start`), and a new case
  asserts Christmas 2025 is now recognised.
- `tests/test_nyse_calendar_parity.py` rewritten from "regex-parse the JS literals" to "both load
  the same JSON": the client derivation (imports + no ISO literal in code, with a control proving
  that check fires on the old shape), the backend sets equal to the JSON per dataset year, every
  early close at 13:00, the backend answering every shared-fixture day row and every mid-RTH
  session row, and the leaf-import rail.
- `sessionCalendar.test.js` compares the dataset to `NYSE_CALENDAR_BY_YEAR` for every covered year
  (close times included) and pins `COVERED_YEARS` to the dataset span.

### Test totals

- `python -m pytest tests/test_session_calendar.py tests/test_nyse_calendar_parity.py -q -p no:cacheprovider`
  → **`181 passed`** (71 in the parity file).
- The same two plus `test_no_shadowed_definitions.py` and every test file naming the NYSE sets or
  `market_calendar` (`test_bar_close_state`, `test_bars_server_include_today`,
  `test_barstate_vendor_mode`, `test_breadth_forward_seal`, `test_chart_health_severity_vocabulary`,
  `test_discord_index_close`, `test_discord_render_freshness`, `test_fed_speaker_roster`,
  `test_intraday_session_completeness`, `test_market_calendar_router`, `test_pre_push_guard`,
  `test_scan_live_window_early_close`, `test_scan_sweep_bar_close_state`) → **`539 passed, 1 failed`**.
  The one failure is `test_bars_server_include_today.py::test_todays_daily_bar_stamps_today_and_caches`:
  it forces the trading-day gate open but not `_regular_session_has_opened_today`'s 09:30 ET clock
  check, and it ran at ~00:30 ET. A wall-clock dependency, not a calendar one.
- `npx vitest run src/lib/marketClock src/components/screener/reachable.test.js` plus the test files
  for `sessionModel`, `FreshnessBadge`, `freshnessAge`, `sessionStale`, `useMarketOpen`,
  `extSession` (2) and `marketSession` (6) → **16 files, `416 passed, 1 failed`**. The failure is
  `reachable.test.js`'s "nothing committed is connected to nothing", listing exactly the three
  pre-existing Pine files (`peelToBuilding.js`, `runtime/handles.js`, `runtime/records.js`).
- The other four client test files that mention a newly covered 2025/2028 holiday
  (`fundamentalAsOf`, `pineTimenowAccept`, `resampleBars.customtf`, `fundamentalSource`) →
  **`52 passed`**.

### Mutation proof

Removed Good Friday `2028-04-14` from `market_calendar.json` (backup
`mut_t035f1_goodfri2028.bak` in the session scratchpad). Restored from the backup;
`git hash-object` equals `git rev-parse HEAD:app/src/lib/marketClock/market_calendar.json`
(`1783cdc0d`) and the bytes equal `git cat-file blob` ignoring CR. `git checkout` was never used.

| | Python (`test_session_calendar` + `test_nyse_calendar_parity`) | vitest (`src/lib/marketClock`) |
|---|---|---|
| Control | 181 passed | 119 passed |
| Good Friday 2028 removed | **4 failed**: 2 shared-fixture rows in `test_session_calendar`, and the backend-set fixture checks `test_day_rows[2028-04-14]` + `test_mid_rth_session_rows[2028-04-14T10:00]` | **3 failed**: 2 shared-fixture rows, and `marketClock.sessionState agrees with every fixture row` — the client clock, through `nyseCalendar.js` |

⭐ The per-year "backend equals the JSON" cases stay green under this mutation, by design: both
sides derive from the file, so that comparison is now a pin on the derivation. The independent
truth is the shared fixture, and it goes red on both runtimes, including through the legacy
backend sets and the client clock.

### Left for follow-up

- `api/routers/market_calendar.py`'s `_REFRESH_HINT` still tells an operator to refresh
  `bars_fetch.py::_NYSE_HOLIDAYS_YYYYMMDD`; the place to refresh is now `market_calendar.json`. The
  router was out of this change's scope.
- Items 2 and 3 of the scattered-user list above are unchanged.
