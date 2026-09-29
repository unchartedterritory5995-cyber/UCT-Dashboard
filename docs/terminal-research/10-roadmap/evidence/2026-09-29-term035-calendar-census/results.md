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

### 1. The two existing lists (migrate first)

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
