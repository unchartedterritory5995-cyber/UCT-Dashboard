# Screener Pre-market Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From 04:00 to 09:30 ET the screener carries a pre-market price and pre-market change % per stock, and two "Morning prep" starters screen on them. All of it is dark behind `SCREENER_PREMARKET_ENABLED`.

**Architecture:** A separate pre-market sweep reads the same cached full-market snapshot the live tier reads and writes its own table, `screener_premarket`. Scans serve the two new columns through a SECOND left join, `pm`, which never touches the regular live overlay (`screener_live`, the 22 live columns, `run_sweep`'s regular-session refusal). Nightly, both columns are blank, exactly like `rvol_live`.

**Tech Stack:** FastAPI + SQLite (screener.db), APScheduler, React, pytest, vitest.

**Spec:** `docs/superpowers/specs/2026-10-16-screener-focus-next-design.md` §2. Owner ruling (2026-10-16): extended-hours prints enter the screener ONLY through these pre-market columns, labelled as pre-market.

## Global Constraints

- Flag `SCREENER_PREMARKET_ENABLED` uses the same three values as `SCREENER_FLAGS` in `api/routers/auth.py`: unset/0 off, 1 everyone, admin owner preview. It is read PER CALL.
  - The sweep runs when the scope is not off.
  - Columns and starters are served to a user only when that user's scope allows it.
  - Off means: no sweep, NULL columns, starters hidden.
- The regular live overlay is unchanged: `live_tier.run_sweep`, `LIVE_COLUMNS`, `screener_live` and the serve predicate. A test asserts the pre-market sweep never writes `screener_live` or `screener_rows`.
- No new provider call. The only market read is `scan_volume.full_market_snapshot()`, a 30 s shared cache.
- A row is written only when the symbol traded TODAY in pre-market (last trade at or after 04:00 ET today). Otherwise `last_price` is yesterday's close and the change would read 0.0% as if measured.
- Served only while `live_tier._session() == "pre_market"`, for today's `session_ymd`, with `premarket_asof` under 180 s old. Otherwise NULL.
- There is no pre-market volume. The filter descriptions say so plainly.
- House rules, identical to the New today plan:
  - new worktree from origin/master, with `.uct-session-owner`;
  - named test files only, run in separate tool calls from commits;
  - `git add` named paths;
  - `git commit -F -` with both trailer lines;
  - hygiene clean;
  - mutation proofs, restored from saved bytes;
  - never `ALLOW_LOCAL_VENDOR_SOCKETS`, never `C:\data`.
- Copy, exactly:
  - column labels `Pre-mkt %` and `Pre-mkt price`;
  - data label `Pre-market · {h:mm AM}`;
  - empty-state line `Pre-market screens fill from 4:00 to 9:30 ET`;
  - starter names `Gapping pre-market` and `Setups gapping pre-market`, group `Morning prep`.

## Review Focus

1. **A symbol with no pre-market trade today** (last trade from yesterday) gets no row, so it never reads as 0.0%. Test in Task 2.
2. **At 09:30 sharp, and after**, the columns serve NULL even though rows still sit in the table. Test in Task 3.
3. **A dead sweeper**: rows older than 180 s serve NULL, so an 08:05 value is never shown at 08:40 as current. Test in Task 3.
4. **Flag at `admin`**: a member's scan returns NULL pre-market columns and no Morning prep starters, while an admin's returns values. Test in Task 3 and Task 4.
5. **Regular live overlay unaffected**: pre-market rows never change any of the 22 live columns in a scan during the session. Test in Task 3.

---

### Task 1: The feed exposes the last-trade time

**Files:**
- Modify: `api/services/massive.py` (`get_full_market_snapshot` parse, ~line 846-866)
- Test: `tests/test_massive_snapshot_last_trade_time.py`

**Interfaces:**
- Produces: each snapshot row gains `last_trade_ns: int | None`, the provider's `lastTrade.t` (nanoseconds since epoch), or None when absent or invalid. All other fields are unchanged.

- [ ] **Step 1: Failing test.**
  - Build a fake raw snapshot payload, shaped exactly like the one the existing parse reads. Copy its shape from the existing massive snapshot tests; find them with `git grep -l get_full_market_snapshot tests`.
  - Use one ticker with `lastTrade: {"p": 10.5, "t": 1792152000000000000}` and one with no `lastTrade`.
  - Assert `last_trade_ns` is the int for the first ticker and None for the second.
  - Assert every pre-existing key is unchanged.
- [ ] **Step 2: Run it and see it fail** (KeyError or missing key).
- [ ] **Step 3: Implement.** In the `out[ticker] = {...}` dict, add `"last_trade_ns": _ns(last.get("t"))`, where `_ns` returns `int(v)` for a positive finite number, else None.
  - Check the sibling parse at ~line 917 (it extracts a richer set).
  - Add the key there too ONLY if `scan_volume.full_market_snapshot` uses that sibling. Read `scan_volume.py:214-237` to see which one it calls.
- [ ] **Step 4: Run it and see it pass.** Also run every existing test file that imports `get_full_market_snapshot` or `full_market_snapshot`.
- [ ] **Step 5: Commit** (`feat(massive): the full-market snapshot carries the last trade time`).

---

### Task 2: The pre-market sweep and its table

**Files:**
- Create: `api/services/screener/premarket.py`
- Modify: `api/main.py` (`register_screener_jobs`: one interval job)
- Modify: `api/routers/auth.py` (`SCREENER_FLAGS` gains `"SCREENER_PREMARKET_ENABLED": False`)
- Modify: `tests/test_screener_focus_flag.py` (the exact-dict assertion gains the new key)
- Modify: `docs/feature_flags.json` (dark entry, edited as TEXT)
- Test: `tests/test_screener_premarket_sweep.py`

**Interfaces:**
- Consumes: `scan_volume.full_market_snapshot()`, `scan_volume._snap_lookup`, `live_tier._session()`, `live_tier._now_et()`, `live_tier.session_ymd(now)`, `snapshot_db.connect()`, and the Task 1 `last_trade_ns`.
- Produces:
  - `premarket.TABLE = "screener_premarket"` with columns `ticker TEXT PRIMARY KEY, session_ymd INTEGER, premarket_price REAL, premarket_chg_pct REAL, premarket_asof REAL`;
  - `premarket.COLUMNS = ("premarket_price", "premarket_chg_pct")`;
  - `premarket.MAX_AGE_S = 180`;
  - `premarket.sweep_enabled() -> bool`;
  - `premarket.served_to(user: dict | None) -> bool`;
  - `premarket.run_sweep() -> dict` receipt `{skipped_reason, considered, written, not_traded_today, no_feed, as_of}`;
  - `premarket.last_receipt() -> dict | None`.

- [ ] **Step 1: Failing tests** (`tests/test_screener_premarket_sweep.py`). Use a `tmp_path` `SCREENER_DB_PATH`, `snapshot_db.init_db()`, `monkeypatch` `live_tier._session`/`_now_et` and `scan_volume.full_market_snapshot`, and seed `screener_rows` with `snapshot_db.upsert_rows`. Cases:
  1. In `pre_market` at 08:42 ET, a ticker whose `last_trade_ns` is 08:41 ET today, with `last_price` 105 and `prev_close` 100, gets a row with `premarket_chg_pct == 5.0`, `premarket_price == 105.0` and `session_ymd` today.
  2. A ticker whose `last_trade_ns` is yesterday 19:59 ET gets NO row, and is counted in `not_traded_today`.
  3. In `regular` or `post_market`, the receipt says `skipped_reason="not_pre_market"` and writes nothing.
  4. With the flag off (unset), the receipt says `skipped_reason="disabled"` and writes nothing.
  5. **Never touches the other tables:** take a `SELECT *` fingerprint of `screener_live` (create it via `init_db`) and `screener_rows` before and after a writing sweep, and assert both are equal.
  6. Rows from a previous `session_ymd` are deleted by today's first sweep.
  7. `served_to({"role": "admin"})` is True and `served_to({"role": "member"})` is False at `admin`; both are True at `1`; both are False when unset.
- [ ] **Step 2: Run them and see them fail** (no module).
- [ ] **Step 3: Implement `premarket.py`:**
  - `sweep_enabled()` = `auth._breadth_dc_scope(FLAG, auth.SCREENER_FLAGS[FLAG]) != auth._SCOPE_OFF`.
  - `served_to(user)` = `auth._screener_flags(is_admin=(user or {}).get("role") == "admin")["screener_premarket_enabled"]`.
  - `run_sweep()` does the following, then records the receipt in a module-level `_LAST` for `last_receipt()`:
    - if `not sweep_enabled()`, return `disabled`;
    - if `live_tier._session() != "pre_market"`, return `not_pre_market`;
    - otherwise:
      1. `now = live_tier._now_et()`; `ymd = live_tier.session_ymd(now)`; `cutoff_ns = int(now.replace(hour=4, minute=0, second=0, microsecond=0).timestamp() * 1e9)`;
      2. `snap = scan_volume.full_market_snapshot() or {}`;
      3. read the tickers with `SELECT ticker FROM screener_rows`;
      4. for each ticker, `q = scan_volume._snap_lookup(snap, ticker)`:
         - no `q` → count `no_feed`;
         - `q.get("last_trade_ns")` missing or below `cutoff_ns` → count `not_traded_today`;
         - otherwise compute `px = q["last_price"]` and `pc = q["prev_close"]`. If both are positive, append `(ticker, ymd, round(px, 4), round((px / pc - 1) * 100, 2), time.time())`;
      5. in ONE transaction: `CREATE TABLE IF NOT EXISTS`, `DELETE FROM screener_premarket WHERE session_ymd != ?`, then `INSERT OR REPLACE` the batch.
- [ ] **Step 4: Scheduler, flag and ledger.**
  - **Scheduler:** in `api/main.py` `register_screener_jobs`, beside the live tier job (search `screener_live_tier`), add:
    `scheduler.add_job(_run_premarket, trigger=IntervalTrigger(seconds=60), id="screener_premarket_sweep", max_instances=1, replace_existing=True, coalesce=True)`, where `_run_premarket` calls `premarket.run_sweep()` inside try/except and prints errors.
    ⚠️ The job itself is cheap when not pre-market: the session check comes first, before any read.
  - **Flag:** add `"SCREENER_PREMARKET_ENABLED": False` to `SCREENER_FLAGS`.
  - **Exact-dict test:** update the exact-dict assertion in `tests/test_screener_focus_flag.py`, which by then also contains `screener_new_today_enabled` if that branch landed first. Rebase, and keep both keys.
  - **Ledger:** add the dark entry to `docs/feature_flags.json` as TEXT, never load and re-dump.
- [ ] **Step 5: Run the new file and the flag and ledger rails, and see them pass.** The rails are `tests/test_screener_focus_flag.py` and `tests/test_visibility_flag_ledger.py`, plus every `git ls-files tests | grep -E "flag_ledger|census"` file. Any red that also fails on origin/master is pre-existing: prove it on a detached master worktree, record it, and do not fix it.
- [ ] **Step 6: Mutation proof.** Each of these must turn a test red:
  - (a) drop the `cutoff_ns` check;
  - (b) drop the session check;
  - (c) write to `screener_live` instead.
- [ ] **Step 7: Commit** (`feat(screener): pre-market sweep into its own table (dark)`).

---

### Task 3: Serving the two columns through a second join

**Files:**
- Modify: `api/services/screener/snapshot_db.py` (`COLUMNS` and its schema migration gain `premarket_price`, `premarket_chg_pct`; both join `LIVE_ONLY_COLUMNS`, which means blank in every nightly build)
- Modify: `api/services/screener/query.py` (`_Overlay` + `_overlay(conn, user=None)` + `run_scan`/`preview_count` pass the user)
- Modify: `api/services/screener/filters.py` (two `_range` filters in the `technical` category, next to `rvol_live` ~line 382)
- Modify: `app/src/pages/screener/columnDefs.js` (two defs with `desc`)
- Modify: `api/services/screener/membership.py`, ONLY if the New today branch has landed: add both columns to `LIVE_ONLY_COLUMNS` there, so a pre-market screen answers `live_screen`
- Test: `tests/test_screener_premarket_serving.py`

**Interfaces:**
- Consumes: `premarket.TABLE`, `premarket.COLUMNS`, `premarket.MAX_AGE_S`, `premarket.served_to(user)` (Task 2), and `live_tier._session()` / `session_ymd(_now_et())`.
- Produces: `run_scan(spec, user_id, user)` and `preview_count(spec, user_id, user=...)` answer the two columns from `pm` when served, and NULL otherwise.

- [ ] **Step 1: Failing tests** (`tests/test_screener_premarket_serving.py`). Use a tmp DB. Seed `screener_rows` (the two columns NULL) and `screener_premarket` rows for today. Monkeypatch `live_tier._session` and `_now_et`, and set `SCREENER_PREMARKET_ENABLED=1`. Cases, each through `query.run_scan({...filters..., "page_size": 500}, user={"role": "member"})`:
  1. **Pre-market, fresh row:** `premarket_chg_pct >= 3` returns the ticker, and the row's `premarket_chg_pct` equals the stored value.
  2. **Regular session (09:31):** the same filter returns nothing, and the row's value is None.
  3. **Stale row** (`premarket_asof` = now − 181 s) serves None.
  4. **Yesterday's `session_ymd`** serves None.
  5. **Flag `admin`:** a member gets None and an admin gets the value.
  6. **Regular live overlay unchanged:** in the regular session, with live tier rows present for a ticker, `price` and `gap_pct` equal what the live tier serves with or without a `screener_premarket` row for that ticker. Copy the live-tier fixture setup from `tests/test_screener_live_tier.py`'s `live_env`.
  7. **The count matches the scan:** `preview_count` of the pre-market filter equals `run_scan`'s `total` for the same user.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - `snapshot_db`: add the two names to `COLUMNS`, to the migration path `init_db` uses to add new columns, and to `LIVE_ONLY_COLUMNS`. Mirror exactly how `rvol_live` was added; find it with `git log -S'"rvol_live"' -- api/services/screener/snapshot_db.py`.
  - `query._Overlay` gains slots `pm_on`, `pm_columns`, `pm_params`:
    - `col_expr(col)`: if `col in self.pm_columns`, return `f'pm."{col}"'` when `pm_on`, else `'NULL'`. This branch comes BEFORE the existing `if not self.on`, so it works whether the live overlay is on or off.
    - `from_sql()`: build the base (`_ROWS`, or `_ROWS LEFT JOIN {live} l ON …` exactly as today). If `pm_on`, append `f' LEFT JOIN {premarket.TABLE} pm ON pm.ticker = {_ROWS}.ticker AND pm.session_ymd = ? AND pm.premarket_asof >= ?'`.
    - `join_params` must stay ONE list in SQL order: the live params first (unchanged), then `pm_params = [ymd, time.time() - MAX_AGE_S]`. Check that every site that splices `overlay.join_params` (query.py ~1431, ~1520, ~1684, ~1769, ~1828) still gets them in FROM-clause order. The ~1684 site reads `join_params[0]` as the live cutoff; it must keep reading the LIVE param only. Give the live-only list its own name if needed.
  - `_overlay(conn, user=None)`: after the existing decision, set `pm_on = premarket.served_to(user) and live_tier._session() == "pre_market" and _table_exists(conn, premarket.TABLE)`. Any exception means `pm_on=False`. Thread `user` from `run_scan`/`preview_count`/`preview_count_batch` (they already receive `user` or `user_id`; read the signatures).
  - `filters.py`:
    - `_range("premarket_chg_pct", "Pre-mkt %", "technical", "premarket_chg_pct", ...)`;
    - `_range("premarket_price", "Pre-mkt price", "technical", "premarket_price", unit="$")`.
    - Mirror `rvol_live`'s `_range` call and its description field. The description says: "From the last pre-market trade, 4:00–9:30 ET; blank outside that window. No pre-market volume is available, so these screens cannot filter on it."
  - `columnDefs.js`: `premarket_chg_pct: { label: 'Pre-mkt %', fmt: <the existing pct formatter used by chg_pct_1d>, desc: … }` and `premarket_price: { label: 'Pre-mkt price', fmt: <price formatter>, desc: … }`. `tests/test_screener_wave1_columndefs.py` must stay green.
- [ ] **Step 4: Run the new file, then every screener query, overlay and live-tier test file, and see them pass.** Find them with `git ls-files tests | grep -E "screener_(query|live|overlay|count|scan)|live_tier|wave1_columndefs"`. Run in chunks of at most 8 files.
- [ ] **Step 5: Mutation proof.** Each of these must turn a test red:
  - (a) drop the `premarket_asof >= ?` clause;
  - (b) drop the session check in `_overlay`;
  - (c) serve `pm` columns for any user;
  - (d) put pm params before the live params.
- [ ] **Step 6: Commit** (`feat(screener): serve pre-market columns through their own join (dark)`).

---

### Task 4: Starters, the empty state and the data label

**Files:**
- Modify: `api/services/screener/saved_screens.py` (two starters, `group: "Morning prep"`, shown only when `premarket.served_to(user)`)
- Modify: the saved-screens route that returns starters (find it with `git grep -n "starters()" api/routers`) so it passes the user and filters
- Modify: `app/src/pages/screener/focus/screenGroups.js` (group key for the two ids)
- Modify: `app/src/pages/screener/focus/emptyReason.js` (pre-market reason)
- Modify: `api/routers/screener.py` `snapshot-status` (adds `premarket: premarket.last_receipt()`)
- Modify: `app/src/pages/screener/focus/DataReceipt.jsx` (the label `Pre-market · h:mm AM` when the pre-market receipt is fresh and the session is pre-market)
- Test: `tests/test_screener_premarket_starters.py`, `app/src/pages/screener/focus/__tests__/premarket.test.jsx`

**Interfaces:**
- Consumes: Tasks 2-3.
- Produces:
  - starter ids `starter_premarket_gappers`: `premarket_chg_pct >= 3`, `dollar_vol_30d >= 10_000_000`, `price >= 5`, sort `premarket_chg_pct` desc, view `technical`;
  - starter id `starter_premarket_setups`: `base_pivot_px gte 0` (the presence ruling), `premarket_chg_pct >= 2`, `dollar_vol_30d >= 10_000_000`, same sort.

- [ ] **Step 1: Failing tests.**
  - **Backend:**
    - both starters run through `run_scan` in a pre-market fixture and return the expected tickers;
    - the starters list for a member at flag `admin` excludes both ids, and for an admin includes them;
    - `snapshot-status` carries a `premarket` key.
  - **Frontend:**
    - `emptyReason` for a pre-market starter outside 04:00–09:30 returns `Pre-market screens fill from 4:00 to 9:30 ET`;
    - `DataReceipt` with a fresh pre-market receipt at 08:42 renders `Pre-market · 8:42 AM`;
    - outside pre-market it renders the existing Live or nightly label unchanged.
    - Read `emptyReason.js` and `DataReceipt.jsx` first, and extend their own test files if they exist.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** the starters, mirroring `starter_gap_up_volume`'s shape and description style:
  - "Stocks up 3%+ before the open (4:00–9:30 ET), $10M+ traded daily, price $5+. No pre-market volume is available.";
  - "Stocks with a base pivot, up 2%+ before the open, $10M+ traded daily. No pre-market volume is available."
  - Then wire the route filter, the empty reason, the status key and the label.
- [ ] **Step 4: Run the new tests, `tests/test_screener_saved.py`, `tests/test_screener_scan_intel.py`, `tests/test_scan_screener_auth.py`, and all of `src/pages/screener/focus/`, and see them pass.**
- [ ] **Step 5: Mutation proof.** Each of these must turn a test red:
  - (a) show the starters to everyone;
  - (b) make the label ignore the session.
- [ ] **Step 6: Commit** (`feat(screener): Morning prep starters, pre-market label and empty state (dark)`).

---

## Rollout (controller)

1. Open the PR, wait for the checks, then merge. Only one master merge at a time; wait for web SUCCESS.
2. Set `SCREENER_PREMARKET_ENABLED=admin` on web. Verify a new boot, and read the value in-process.
3. **Next weekday, 08:00–09:15 ET:** read `/api/screener/snapshot-status` → `premarket` (written > 0, as_of fresh). Walk as smoke@:
   - the label reads `Pre-market · …`;
   - `Gapping pre-market` lists names whose change matches the pre-market move;
   - send screenshots.
4. **At 09:31**, confirm the columns blank and the label returns to Live.
5. On the owner's go, set the flag to `1` and update the ledger in the same docs push.
