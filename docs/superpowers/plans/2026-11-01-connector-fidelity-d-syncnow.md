# Connector fidelity, Plan D: Sync now shows remote deletions, plus the leftovers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pressing **Sync now** checks for notes removed in the source app on that press, within the existing safety rules. The card says plainly when a removal is still waiting to be confirmed. The five §8 leftovers are fixed: busy returns 409, the skipped count is shown, the folder picker race is closed, cross-device OAuth gets a real message, and the log route returns camelCase and renders on the card.

**Architecture:** The engine gets one new caller mode, `member=True`, and the router's Sync now route is its only caller. In that mode the engine tries the lock once and returns `busy` at once instead of walking the retry ladder. A full request is either downgraded to incremental (when any full pass for that source ran less than `MEMBER_FULL_PASS_MIN_INTERVAL_S` ago) or run as a **removal check**: a complete enumeration for delete detection, while note content is fetched only for the incremental delta. Delete detection stamps `j2_note_sources.last_full_sync_at` in the same transaction that records strikes. Because of that stamp, two member strikes are always at least 10 minutes apart, with no second guard. The pending-removal count is derived from `j2_note_remote_index.miss_streak >= 1` and is not stored as a second copy. The frontend sends `full=1` on every Sync now, renders the new state, and reads the camelCased log.

**Tech Stack:** FastAPI + SQLite (`auth.db`, `j2_` tables), pytest (asyncio auto mode); React + SWR, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-01-connector-fidelity-and-evernote-design.md` (§7, §8, §15 Q4; §4 anti-goals; §11 constraints).

## Global Constraints

- The safety rule does not change (§15 Q4). A severed note is tagged `source-deleted` and its `j2_note_remote_index` row is deleted. The note itself is never erased.
- The `<50%` enumeration refuse guard (`engine.py` `_run_delete_detection`, `len(seen_ids) < prev_count * 0.5`) and the explicit-delete cap `max(1, int(prev_count * 0.2))` stay byte-for-byte. Their existing tests must stay green without edits.
- **The 2-strike rule:** an explicit trash list (`list_deleted`: Notion, OneDrive) severs on one press, within the cap. Enumeration-only misses record strike 1 and sever on strike 2.
- **The member full-pass rate limit is `MEMBER_FULL_PASS_MIN_INTERVAL_S = 600`** (10 minutes) per source, measured from `last_full_sync_at`. Every full pass writes that column, scheduler passes and member passes alike. The same constant is what makes "strike 2 only if at least 10 minutes after strike 1" hold for member passes. It is ONE guard (§4: "one guard, mutation-proved, per invariant"), so the plan adds no separate strike-gap check. Scheduler (nightly) passes are never rate-limited and always count as a strike (spec: "otherwise the nightly pass confirms").
- Timestamp-neutral: no new code writes `j2_notes`. Tag writes stay on `_write_tags_preserving_updated_at`. New writes touch only `j2_note_sources`, `j2_note_remote_index` and `j2_note_sync_log`.
- Pending card copy, verbatim from §15 Q4: `N notes look removed in <app>; confirming on the next check.`, singular `1 note looks removed in <app>; confirming on the next check.`
- Busy copy (§8.1): HTTP **409**, detail `A sync is already running for this source. Its results will appear here when it finishes.`
- Each new SQLite column is declared in THREE places in `api/services/journal_two/db.py`: `_J2_SCHEMA`, `_NOTE_CONNECTOR_TABLE_DDL`, and the idempotent `ALTER` list after migration v3 (~line 2600).
- No new dependencies. No new `localStorage` keys (persistence census). No new key listeners (`pages/command/keyListenerCensus.test.js`).
- TERM-033: every new response-body read uses `readSuccessBody`/`failureDetail` from `app/src/lib/responseBody.js`. Never write `.catch(() => null)`, `.catch(() => undefined)` or `.catch(() => ({}))` on a body read.
- vitest: run test FILES by path. Never use `-t`, which is a regex: a filter that matches nothing exits 0.
- Backend tests: `python -m pytest <path> -q` from the repo root. Never run heavy jobs on the prod pod.
- Branch off master; ship by PR. No `requirements.txt` change, so no flow-worker override step.

## Review Focus

1. **A brand-new source (nothing tracked yet) presses Sync now.** The removal check must run with `prev_count == 0`: no guard warning, `pending == 0`, nothing about removals on the card. (Test in Task 3: `test_removal_check_on_an_empty_index_is_a_quiet_no_op`.)
2. **`last_full_sync_at` is unparseable or more than 60 s in the future** (bad clock, hand-edited row). The member must not be locked out: treat it as "no previous full pass" and allow the check. (Test in Task 3: `test_an_unreadable_or_future_last_full_stamp_never_locks_the_member_out`.)
3. **A note at strike 1 is edited in the source app, so it reappears in an INCREMENTAL pass.** It must heal: `miss_streak` back to 0, the pending count drops, and it is never tagged. (Test in Task 3: `test_a_pending_note_that_reappears_incrementally_heals_and_leaves_the_count`.)
4. **The folder picker is closed while a listing is in flight, then reopened.** The stale response must not overwrite the fresh root listing. (Test in Task 8: `ignores a listing that resolves after the picker was reopened`.)
5. **A log row written before plan A** (`failures_json` NULL) or with malformed JSON. NULL means `failures: []`. Malformed JSON means `failures: []` plus `failuresUnreadable: true`, never a confident empty list. (Tests in Task 4: `test_source_log_rows_are_camelcase_with_failures_parsed` and `test_source_log_marks_unreadable_failures_instead_of_reporting_none`.)

---

### Task 1: Schema: `last_full_sync_at`, `failures_json`, and the pending-removal read

**Files:**
- Modify: `api/services/journal_two/db.py` (`_J2_SCHEMA` ~700-734, `_NOTE_CONNECTOR_TABLE_DDL` ~2975-3010, ALTER list ~2600-2618)
- Modify: `api/services/journal_two/note_connectors/connections.py` (`_row_to_source` ~543; new function after `list_sources`)
- Test: `api/services/journal_two/test_note_connectors_db.py`, `api/services/journal_two/test_note_connectors_connections.py`

**Interfaces:**
- Produces: column `j2_note_sources.last_full_sync_at TEXT` (ISO-8601 UTC, NULL = never). Column `j2_note_sync_log.failures_json TEXT`: a JSON array of `{"noteTitle": str, "reason": str, "name": str | null}`, NULL = none recorded. **Plan D owns this column's DDL; plan A only writes it.**
- Produces: `_row_to_source(...)["lastFullSyncAt"]: str | None`.
- Produces: `connections.pending_removal_counts(user_id: str, source_ids: list[str], conn: sqlite3.Connection | None = None) -> dict[str, int]`. It is one `GROUP BY` query over `j2_note_remote_index WHERE miss_streak >= 1`. Sources with zero pending are absent from the dict, and `[]` returns `{}` without querying.

- [ ] **Step 1: Write the failing tests**

```python
# test_note_connectors_db.py
def test_ensure_schema_adds_last_full_sync_at_and_failures_json_to_an_older_db(tmp_path, monkeypatch):
    # build a DB from the pre-change DDL (copy the existing pre_task8 test's shape), run ensure_schema twice
    cols_src = {r[1] for r in conn.execute("PRAGMA table_info(j2_note_sources)")}
    cols_log = {r[1] for r in conn.execute("PRAGMA table_info(j2_note_sync_log)")}
    assert "last_full_sync_at" in cols_src and "failures_json" in cols_log

def test_fresh_schema_declares_both_new_columns():  # fresh ensure_schema, same two asserts

# test_note_connectors_connections.py
def test_pending_removal_counts_counts_only_rows_at_strike_one_or_more(db):
    # seed remote_index for s1: miss_streak 0,1,1 ; s2: 0
    assert db.pending_removal_counts("u1", [s1, s2]) == {s1: 2}
    assert db.pending_removal_counts("u1", []) == {}
    assert db.pending_removal_counts("u2", [s1]) == {}   # user-scoped

def test_source_dict_carries_last_full_sync_at(db):
    s = db.create_source("u1", "fake", "g")
    assert db.get_source_by_id(s["id"])["lastFullSyncAt"] is None
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `python -m pytest api/services/journal_two/test_note_connectors_db.py api/services/journal_two/test_note_connectors_connections.py -q`
Expected: the new tests FAIL (missing column / `AttributeError: pending_removal_counts`).

- [ ] **Step 3: Add the two columns in all three DDL places, `lastFullSyncAt` in `_row_to_source`, and `pending_removal_counts`**

- [ ] **Step 4: Run both files again and confirm they pass**

Same command. Expected: all PASS, including the existing `test_ensure_schema_upgrades_a_v2_shaped_db_and_is_idempotent`.

- [ ] **Step 5: Commit**: `git commit -m "feat(note-sync): last_full_sync_at + failures_json columns, pending_removal_counts"`

---

### Task 2: Engine: a member caller never waits through the busy ladder

**Files:**
- Modify: `api/services/journal_two/note_connectors/engine.py` (`sync_source` 281-319; add `is_source_busy` beside `_try_acquire_source`)
- Test: `api/services/journal_two/test_note_connectors_engine.py`

**Interfaces:**
- Produces: `async def sync_source(source_id: str, *, full: bool = False, manual: bool = False, member: bool = False) -> dict[str, Any]`. `member=True` implies `manual=True` (no cooldown). It makes ONE acquire attempt and, if that fails, returns `{"status": "busy", "sourceId": source_id}` with no sleep. The sqlite "database is locked" retry ladder is unchanged for all callers. When `member=False`, behaviour is byte-identical to today.
- Produces: `def is_source_busy(source_id: str) -> bool`. It reads `_inflight_sources` under `_inflight_lock`.

- [ ] **Step 1: Write the failing tests**

```python
async def test_a_member_sync_on_a_busy_source_returns_busy_without_sleeping(source, provider, monkeypatch):
    slept = []
    async def fake_sleep(s): slept.append(s)
    monkeypatch.setattr(engine.asyncio, "sleep", fake_sleep)
    assert engine._try_acquire_source(source["id"])
    try:
        r = await engine.sync_source(source["id"], member=True)
    finally:
        engine._release_source(source["id"])
    assert r == {"status": "busy", "sourceId": source["id"]}
    assert slept == []                       # the ladder was not walked
    assert provider.list_changed_calls == []

async def test_a_scheduler_sync_on_a_busy_source_still_walks_the_ladder(source, provider, monkeypatch):
    # same setup, member omitted: len(slept) == len(engine._LOCKED_RETRY_DELAYS), status busy

def test_is_source_busy_reflects_the_inflight_set(source):
    assert engine.is_source_busy(source["id"]) is False
    engine._try_acquire_source(source["id"]); assert engine.is_source_busy(source["id"]) is True
    engine._release_source(source["id"])
```

- [ ] **Step 2: Run them and confirm they fail**: `python -m pytest api/services/journal_two/test_note_connectors_engine.py -q -k "busy"` (`-k` is a pytest substring filter, not vitest). Expected: FAIL (`unexpected keyword 'member'`, missing `is_source_busy`).
- [ ] **Step 3: Implement**: when `member` is set, the attempt count for the busy branch is 1, and the cooldown is skipped as if `manual=True`.
- [ ] **Step 4: Run the whole engine file**: `python -m pytest api/services/journal_two/test_note_connectors_engine.py -q`. Expected: all PASS, including the cross-loop contention test.
- [ ] **Step 5: Commit**: `git commit -m "feat(note-sync): member sync fails fast when the source is busy"`

---

### Task 3: Engine: the removal check (member full pass), rate limit, pending count

**Files:**
- Modify: `api/services/journal_two/note_connectors/engine.py` (`_now_iso` 166; `sync_source`; `_do_sync` 395-640; `_run_delete_detection` 644-759; `_touch_remote_index` 863-913 unchanged)
- Test: `api/services/journal_two/test_note_connectors_engine.py` (new section "Sync now removal check"); reuse the `source`/`provider` fixtures and `FakeProvider`

**Interfaces:**
- Consumes: Task 1's `connections.pending_removal_counts`, `source["lastFullSyncAt"]`, and Task 2's `member` kwarg.
- Produces: module constant `MEMBER_FULL_PASS_MIN_INTERVAL_S = 600`, and `def _utcnow() -> datetime`. `_now_iso()` returns `_utcnow().isoformat()`. Tests monkeypatch `engine._utcnow` to move the clock.
- Produces: `sync_source(id, full=True, member=True)` result = the existing result dict plus
  `"removalCheck": {"ran": bool, "reason": None | "rate_limited" | "refused" | "enumeration_failed", "nextAllowedAt": str | None, "pending": int, "severed": int}`.
  `removalCheck` is present only when `member and full`. `pending` = `pending_removal_counts(...)[source_id]` after the pass (0 when absent). `severed` = this pass's `sourceDeleted`. `nextAllowedAt` = `last_full_sync_at + 600 s` (ISO).
- Produces: `_run_delete_detection(..., *, deleted_refs=None, stamp_at: str)` returns the existing dict plus `"refused": bool`, which is True only on the <50% branch. In the SAME transaction, on every branch including the refuse branch, it executes `UPDATE j2_note_sources SET last_full_sync_at = ? WHERE id = ? AND user_id = ?`. The refuse branch therefore now commits.
- Produces: `async def _do_sync(user_id, source_id, *, full: bool, removal_check: bool = False)`. The two flags are mutually exclusive; the caller guarantees it.

**Rules the code must follow (decided here):**
- **Downgrade:** with `member and full`, parse `lastFullSyncAt`. If it parses and `_utcnow() - 60s <= last <= _utcnow()` holds with `_utcnow() - last < MEMBER_FULL_PASS_MIN_INTERVAL_S`, run `_do_sync(full=False)` and return `removalCheck.ran = False, reason "rate_limited"`. An unparseable value, or one more than 60 s in the future, counts as "no previous full pass".
- **Removal check order:** (1) `index_refs = present_fn(creds)` if the provider has `list_present_refs`, else `provider.list_changed(creds, cursor=None)`. (2) `refs = provider.list_changed(creds, cursor=source["cursor"])`, the stored cursor, called LAST so every provider's per-call instance state (Notion `_page_meta`, Craft `_doc_meta`, Dropbox/OneDrive `opaque_cursor`, OneDrive `_deleted_refs`, Roam `_title_to_uid`) ends exactly as after a plain incremental pass. (3) `list_deleted(creds)` if present. (4) `index_refs = union(index_refs, refs)` by `remote_id`: a page in either listing is present, which absorbs Notion search-index lag in either listing. (5) `_run_delete_detection`. (6) `_touch_remote_index(index_refs)`. (7) Fetch and import only `refs`. The cursor-advance logic is the existing incremental logic.
- If step (1) raises: append the failure to `item_failures`, skip (3)-(5), set `removalCheck = {ran: False, reason: "enumeration_failed"}`, and carry on as an incremental pass. The `<50%` refusal maps to `ran: True, reason: "refused"`.
- The scheduler `full=True` path (`sync_all_active_sources_full`) is unchanged except that it now also stamps `last_full_sync_at` through `_run_delete_detection`.

- [ ] **Step 1: Write the failing tests**

```python
T0 = datetime(2026, 11, 1, 15, 0, tzinfo=timezone.utc)
def _at(monkeypatch, dt): monkeypatch.setattr(engine, "_utcnow", lambda: dt)
def _refs(*ids): return [RemoteRef(remote_id=i, updated_at="2026-08-01T00:00:00+00:00") for i in ids]

async def test_explicit_trash_severs_on_one_member_press(source, provider, monkeypatch):
    provider.refs = _refs("a", "b", "c", "d", "e"); provider.notes_by_id = {i: _rn(i, i.upper()) for i in "abcde"}
    _at(monkeypatch, T0); await engine.sync_source(source["id"], full=True)            # scheduler seed
    provider.refs = _refs("a", "b", "c", "d")
    async def trash(c): return _refs("e")
    provider.list_deleted = trash
    _at(monkeypatch, T0 + timedelta(minutes=11))
    r = await engine.sync_source(source["id"], full=True, member=True)
    assert r["removalCheck"] == {"ran": True, "reason": None, "pending": 0, "severed": 1,
                                 "nextAllowedAt": (T0 + timedelta(minutes=21)).isoformat()}
    assert "source-deleted" in _note_by_title("E")["tags"]

async def test_an_enumeration_miss_is_strike_one_and_reported_pending(source, provider, monkeypatch):
    # seed a..e at T0; drop "e"; member press at T0+11m  ->  ran True, pending 1, severed 0, E not tagged

async def test_a_second_press_inside_ten_minutes_is_not_a_strike(source, provider, monkeypatch):
    # after strike 1 at T0+11m, press at T0+16m:
    assert r["removalCheck"]["ran"] is False and r["removalCheck"]["reason"] == "rate_limited"
    assert r["removalCheck"]["nextAllowedAt"] == (T0 + timedelta(minutes=21)).isoformat()
    assert r["removalCheck"]["pending"] == 1 and "source-deleted" not in _note_by_title("E")["tags"]
    assert provider.list_changed_calls[-1] == stored_cursor     # downgraded to incremental, one call only

async def test_a_second_press_after_ten_minutes_confirms_the_removal(source, provider, monkeypatch):
    # strike 1 at T0+11m, press at T0+22m  ->  severed 1, pending 0, E tagged, index row gone

async def test_the_nightly_pass_confirms_regardless_of_the_member_gap(source, provider, monkeypatch):
    # strike 1 by member at T0+11m, scheduler full pass at T0+13m  ->  sourceDeleted 1 (spec: nightly confirms)

async def test_search_index_lag_never_severs_a_page_that_comes_back(source, provider, monkeypatch):
    # Notion-shaped: list_deleted returns [] (trash index lagging); "e" missing at T0+11m -> pending 1;
    # press at T0+12m -> rate_limited; "e" back in the listing at T0+23m -> pending 0, never tagged
    assert "source-deleted" not in _note_by_title("E")["tags"]
    assert _remote_index_rows(source["id"])  # e row present with miss_streak 0

async def test_removal_check_lists_fully_first_and_fetches_only_the_delta(source, provider, monkeypatch):
    # seed a,b at T0; then add c with a newer updated_at; member press at T0+11m
    assert provider.list_changed_calls[-2:] == [None, stored_cursor]
    assert {x for call in provider.fetch_many_calls for x in call} == {"c"}

async def test_the_under_half_guard_still_refuses_a_member_press(source, provider, monkeypatch):
    # seed 4, member press returns 1  ->  removalCheck.reason "refused", pending 0, index miss_streaks unchanged,
    # last_full_sync_at stamped (a refused check is still a check for the rate limit)

async def test_a_failed_enumeration_degrades_to_an_incremental_pass(source, provider, monkeypatch):
    # list_changed raises only when cursor is None  ->  status ok, removalCheck {ran False, reason "enumeration_failed"},
    # delta still imported, last_full_sync_at NOT stamped

async def test_removal_check_on_an_empty_index_is_a_quiet_no_op(source, provider, monkeypatch):
    # brand-new source, first ever call is a member press  ->  ran True, reason None, pending 0, status ok

async def test_an_unreadable_or_future_last_full_stamp_never_locks_the_member_out(source, provider, monkeypatch):
    # set last_full_sync_at to "garbage", then to T0+2h, member press at T0  ->  ran True both times

async def test_a_pending_note_that_reappears_incrementally_heals_and_leaves_the_count(source, provider, monkeypatch):
    # strike 1 on "e"; "e" comes back with a newer updated_at; plain incremental sync  ->
    assert db.pending_removal_counts("u1", [source["id"]]) == {}
    assert "source-deleted" not in _note_by_title("E")["tags"]

async def test_every_full_pass_stamps_last_full_sync_at(source, provider, monkeypatch):
    # scheduler full pass at T0  ->  get_source_by_id(...)["lastFullSyncAt"] == T0.isoformat()
```

**Mutation proof (record it in the PR body):** delete the downgrade branch and confirm `test_a_second_press_inside_ten_minutes_is_not_a_strike` FAILS (E gets tagged). Restore by re-applying the edit, never with `git checkout` (`feedback_mutation_check_never_git_checkout`). Clear `__pycache__` before each run (`lesson_python_pycache_defeats_same_length_mutation`).

- [ ] **Step 2: Run them and confirm they fail**: `python -m pytest api/services/journal_two/test_note_connectors_engine.py -q`. Expected: the new tests FAIL. The existing ones, including `test_a_sever_is_persisted_to_the_sync_log_row_the_card_reads`, `test_delete_detection_needs_two_consecutive_full_misses`, `test_delete_detection_refuses_when_enumeration_returns_under_half` and all `test_list_deleted_*`, still PASS.
- [ ] **Step 3: Implement `_utcnow`, the downgrade, `_do_sync(removal_check=True)`, and the stamp + `refused` in `_run_delete_detection`**, following the rules above.
- [ ] **Step 4: Run the engine file plus its siblings**: `python -m pytest api/services/journal_two/test_note_connectors_engine.py api/services/journal_two/test_note_connectors_engine_present_refs.py api/services/journal_two/test_note_connectors_engine_oauth_refresh.py api/services/journal_two/test_note_connectors_notion.py -q`. Expected: all PASS.
- [ ] **Step 5: Do the mutation proof above.** Expected: the named test goes red under the mutation and green when it is restored.
- [ ] **Step 6: Commit**: `git commit -m "feat(note-sync): Sync now runs a rate-limited removal check (2-strike rule unchanged)"`

---

### Task 4: Router: Sync now route, busy is 409, status fields, camelCase log

**Files:**
- Modify: `api/routers/note_sync.py` (`get_status` 355-383; new `_latest_failure_counts` beside `_latest_sync_counts` 312; `sync_source_now` 751-784; `source_log` 866-881)
- Test: `tests/test_note_sync_router.py`

**Interfaces:**
- Consumes: `engine.sync_source(..., member=True)`, `engine.is_source_busy`, `connections.pending_removal_counts`.
- Produces: `POST /api/j2/notes/connectors/sources/{id}/sync?full=&background=` always calls `engine.sync_source(source_id, full=full, manual=True, member=True)`. When the engine returns `{"status":"busy"}`, respond `409` with detail `BUSY_DETAIL` (module constant, copy in Global Constraints). With `background=1`: if `engine.is_source_busy(id)`, return the same 409 before scheduling; otherwise behave as today, with `member=True`.
- Produces: each `/status` source dict gains `"pendingRemoval": int` and `"lastFailureCount": int` (the length of the newest log row's `failures_json` array, 0 for NULL or unreadable). These are NOT added to `counts`, whose exact shape is pinned by two existing tests.
- Produces: `GET /sources/{id}/log?limit=` returns `{"rows": [LogRow]}` newest-first, with
  `LogRow = {"id": int, "at": str | None, "status": str | None, "created": int, "updated": int, "skipped": int, "conflicts": int, "sourceDeleted": int, "failures": [{"noteTitle": str, "reason": str, "name": str | None}], "failuresUnreadable": bool}`.
  `at` = `finished_at` or `started_at`. Integers are NULL-coalesced to 0. `failures` keeps only those three keys per entry, with a non-string `noteTitle` becoming `"Untitled note"`. Malformed JSON gives `failures: []`, `failuresUnreadable: true`, and a `log.warning`.

- [ ] **Step 1: Update the one existing rail this changes, then write the new tests**

`test_manual_sync_fires_the_engine_with_the_right_args`: the fake becomes `async def fake_sync_source(sid, *, full=False, manual=False, member=False)` and records `member`. The assertions become `[(source_id, False, True, True)]` and `(source_id, True, True, True)`.

```python
def test_manual_sync_on_a_busy_source_is_a_fast_409(client, monkeypatch):
    # fake engine.sync_source returns {"status": "busy", "sourceId": sid}
    r = client.post(f".../sources/{sid}/sync?full=1")
    assert r.status_code == 409 and r.json()["detail"] == note_sync_router.BUSY_DETAIL

def test_background_sync_on_a_busy_source_is_409_and_schedules_nothing(client, monkeypatch):
    monkeypatch.setattr(engine, "is_source_busy", lambda sid: True)   # + a sync_source fake that records calls
    assert client.post(f".../sources/{sid}/sync?background=1").status_code == 409 and calls == []

def test_status_sources_carry_pending_removal_and_last_failure_count(client, monkeypatch):
    # seed remote_index miss_streak 1 x2, newest log row failures_json = json.dumps([{...},{...},{...}])
    src = status["providers"]["roam"]["sources"][0]
    assert src["pendingRemoval"] == 2 and src["lastFailureCount"] == 3
    assert set(src["counts"]) == {"notesCreated","notesUpdated","notesSkipped","mediaUploaded","conflicts","sourceDeleted"}

def test_source_log_rows_are_camelcase_with_failures_parsed(client, monkeypatch):
    # one row with failures_json, one pre-plan-A row with NULL
    rows = client.get(f".../sources/{sid}/log?limit=5").json()["rows"]
    assert rows[0] == {"id": ANY_INT, "at": "t2", "status": "ok", "created": 1, "updated": 2, "skipped": 3,
                       "conflicts": 0, "sourceDeleted": 0, "failuresUnreadable": False,
                       "failures": [{"noteTitle": "Trip", "reason": "Image couldn't be copied", "name": "a.heic"}]}
    assert rows[1]["failures"] == [] and rows[1]["failuresUnreadable"] is False
    assert not any("_" in k for k in rows[0])

def test_source_log_marks_unreadable_failures_instead_of_reporting_none(client, monkeypatch):
    # failures_json = "{not json"  ->  failures [] and failuresUnreadable True
```

- [ ] **Step 2: Run them and confirm they fail**: `python -m pytest tests/test_note_sync_router.py -q`. Expected: the new tests FAIL. `test_the_oauth_callback_starts_the_first_sync_for_the_source_it_creates`, `test_every_oauth_return_lands_on_the_connections_section` and `test_status_source_counts_*` PASS.
- [ ] **Step 3: Implement** `BUSY_DETAIL`, the 409 mapping, `_latest_failure_counts(user_id, source_ids) -> dict[str, int]` (the same newest-row subquery as `_latest_sync_counts`), and the camelCase log projection.
- [ ] **Step 4: Run the file again**: same command. Expected: all PASS. Then `python -m pytest tests/test_note_sync_scheduler_wiring.py -q`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(note-sync): busy Sync now is a fast 409; status pendingRemoval; camelCase log"`

---

### Task 5: Hook: send `full=1`, normalize the result, read the log

**Files:**
- Modify: `app/src/pages/journal-2-0/hooks/useNoteConnectors.js` (`normalizeSource` ~118; `syncSource` ~305; new `getSourceLog`; new exports)
- Test: `app/src/pages/journal-2-0/hooks/useNoteConnectors.test.js`

**Interfaces:**
- Consumes: Task 4's wire shapes.
- Produces: `normalizeSource(raw)` gains `pendingRemoval: number` and `lastFailureCount: number` (default 0, via `pick` with snake_case aliases).
- Produces: `export function normalizeSyncResult(raw) -> { status: string, removalCheck: null | { ran: boolean, reason: string|null, nextAllowedAt: string|null, pending: number, severed: number } }`.
- Produces: `export function normalizeLogRows(raw) -> Array<{ id, at, status, created, updated, skipped, conflicts, sourceDeleted, failures: Array<{noteTitle, reason, name}>, failuresUnreadable: boolean }>`. Missing fields become 0/[]/false, and a non-array `rows` becomes `[]`.
- Produces: `syncSource(sourceId, { background = false } = {})` POSTs `.../sync?full=1` (plus `&background=1`). On `!r.ok` it throws `readError(...)`, so `err.status === 409` and `err.detail === BUSY_DETAIL`. On ok it reads with `readSuccessBody`, calls `mutate()`, and returns `normalizeSyncResult(body)`. An unreadable body returns `{status: 'unknown', removalCheck: null}`.
- Produces: `getSourceLog(sourceId, { limit = 5 } = {}) -> Promise<LogRow[]>`. A non-ok response throws `readError(r, 'Could not load recent syncs.')`. An ok response with an unreadable body throws `Error('Could not read recent syncs.')`. It never returns `[]` for a failure.

- [ ] **Step 1: Write the failing tests** (pure-function tests for both normalizers, plus a `renderHook`/fetch-mock test that `syncSource` hits `?full=1` and `getSourceLog` throws on an unreadable body)

```js
it('Sync now always asks for the removal check', async () => {
  // mock fetch; await result.current.syncSource('s1')
  expect(String(global.fetch.mock.calls.find(c => String(c[0]).includes('/sync'))[0])).toMatch(/\/sources\/s1\/sync\?full=1$/)
})
it('normalizeSyncResult keeps a rate-limited check as a stated outcome', () => {
  expect(normalizeSyncResult({ status: 'ok', removalCheck: { ran: false, reason: 'rate_limited', nextAllowedAt: 'x', pending: 1, severed: 0 } }).removalCheck)
    .toEqual({ ran: false, reason: 'rate_limited', nextAllowedAt: 'x', pending: 1, severed: 0 })
  expect(normalizeSyncResult({ status: 'ok' }).removalCheck).toBeNull()
})
it('normalizeLogRows fills defaults and keeps failuresUnreadable', () => { /* ... */ })
it('getSourceLog rejects on an unreadable body instead of resolving []', async () => { /* json throws */ })
it('normalizeSource reads pendingRemoval and lastFailureCount, defaulting to 0', () => { /* camel + snake */ })
```

- [ ] **Step 2: Run them and confirm they fail**: `cd app && npx vitest run src/pages/journal-2-0/hooks/useNoteConnectors.test.js`. Expected: FAIL (missing exports, URL lacks `?full=1`).
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the hook test plus the TERM-033 census**: `cd app && npx vitest run src/pages/journal-2-0/hooks/useNoteConnectors.test.js src/lib/swallowedFetch.census.test.js`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(notebook-connectors): Sync now requests the removal check; log reader"`

---

### Task 6: Card: Unchanged stat, pending line, sync notices, recent syncs

**Files:**
- Modify: `app/src/pages/journal-2-0/components/connectors/SourceRow.jsx`
- Modify: `app/src/pages/journal-2-0/components/connectors/ConnectedAppsCard.jsx` (`handleSync` ~184 returns the result; the `SourceRow` render ~302 passes the new props)
- Modify: `app/src/pages/journal-2-0/components/connectors/ConnectedAppsCard.module.css` (reuse `.conflictHint`/`.sourceErr`; add `.syncNotice`, `.historyList` only if no existing class fits)
- Test: `app/src/pages/journal-2-0/components/connectors/SourceRow.test.jsx`, `ConnectedAppsCard.test.jsx`

**Interfaces:**
- Consumes: Task 5's `source.pendingRemoval`, `source.lastFailureCount`, `normalizeSyncResult`, `getSourceLog`, `LogRow`.
- Produces: `SourceRow` props gain `providerLabel: string` (default `'the source app'`) and `onLoadLog?: (source) => Promise<LogRow[]>`. `onSync(source)` now resolves to the normalized sync result.

**Rendering rules (decided here):**
- Stats row: `Created`, `Updated`, then **`Unchanged`** = `counts.notesSkipped`, always shown, with `title="Already up to date in your Notebook"`. Existing `Conflicts`/`Removed` stats and hints stay unchanged.
- `pendingRemoval > 0` shows `<p className={styles.conflictHint}>` with the exact Q4 copy, pluralized, using `providerLabel`.
- After a press, one notice line (`role="status"`) shows until the next press:
  - thrown with `status === 409`: `err.detail`
  - any other throw: `err.detail || 'Sync failed. Try again shortly.'`. The old silent `catch {}` is removed, because a 503 used to show nothing.
  - `removalCheck.reason === 'rate_limited'`: `Removals were checked less than 10 minutes ago, so this sync brought in new and edited notes only. Press Sync now again after {time} to check for removals.` `{time}` = `new Date(nextAllowedAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})`.
  - `reason === 'refused'`: `Couldn't confirm removals this time: {providerLabel} returned far fewer notes than expected, so nothing was changed.`
  - `reason === 'enumeration_failed'`: `Couldn't check {providerLabel} for removals this time. New and edited notes were still synced.`
  - otherwise there is no notice; the pending line and stats carry it.
- A **Recent syncs** disclosure button (`aria-expanded`) is shown when `onLoadLog` and `source.lastSyncAt` are present. Its label is `Recent syncs`, plus ` · {N} item(s) didn't come over` when `lastFailureCount > 0`. The first expand calls `onLoadLog(source)` once. Each row renders as `{timeAgo(at)}: {created} new, {updated} updated, {skipped} unchanged`, with `, {conflicts} conflicts` / `, {sourceDeleted} removed` when non-zero. Under it goes a `<ul>` of failures, one per entry: `{noteTitle}: {name ? name + ', ' : ''}{reason}`. **`reason` is rendered verbatim** because plan A writes member-readable copy. `failuresUnreadable` renders `Details for this sync couldn't be read.` A rejected `onLoadLog` renders `err.message` with a `Try again` button. While loading it uses the existing `SkeletonLine`.

- [ ] **Step 1: Write the failing tests** in `SourceRow.test.jsx`:

```js
it('shows Unchanged from notesSkipped', ...)                                   // counts.notesSkipped: 7 -> "7" + "Unchanged"
it('says a removal is pending confirmation, in the spec\'s words', ...)        // pendingRemoval 3, providerLabel "Notion"
  // expect(screen.getByText('3 notes look removed in Notion; confirming on the next check.'))
it('singular pending copy', ...)                                               // pendingRemoval 1 -> "1 note looks removed in Notion; ..."
it('a busy press says a sync is already running', ...)                          // onSync rejects {status:409, detail: BUSY}
it('a non-409 failure is shown, not swallowed', ...)                            // reject {status:503, detail:'x'} -> 'x'
it('a rate-limited press explains why removals were not checked', ...)          // resolves removalCheck.reason 'rate_limited'
it('recent syncs list what did not come over, verbatim', async ...)             // onLoadLog resolves one row with a failure
it('recent syncs never reads as "nothing failed" when details were unreadable', ...)
it('loads the log once, on first expand', ...)
```

In `ConnectedAppsCard.test.jsx`: `it('passes the provider label so the pending line names the app', ...)`, with status fixture `pendingRemoval: 2` on the roam source, expecting `2 notes look removed in Roam Research; confirming on the next check.`. Also update the existing `'Sync now fires POST /sources/{id}/sync'` test only if its URL `includes` match breaks; it should not, because it matches `/sources/src-roam-1/sync`.

- [ ] **Step 2: Run them and confirm they fail**: `cd app && npx vitest run src/pages/journal-2-0/components/connectors/SourceRow.test.jsx src/pages/journal-2-0/components/connectors/ConnectedAppsCard.test.jsx`. Expected: the new tests FAIL; the existing ones PASS.
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run both files plus the rails**: `cd app && npx vitest run src/pages/journal-2-0/components/connectors/ src/pages/command/keyListenerCensus.test.js src/lib/persistence/persistenceManifest.test.js src/lib/swallowedFetch.census.test.js`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(notebook-connectors): card shows pending removals, skipped count, busy/rate-limit notices, recent syncs"`

---

### Task 7: Cross-device OAuth: say what happened and how to finish

**Files:**
- Modify: `api/routers/note_sync.py` (`oauth_callback` 528-575; new `_oauth_state_failure_page(provider: str) -> HTMLResponse`; import `HTMLResponse`)
- Modify: `app/src/pages/journal-2-0/components/connectors/ConnectedAppsCard.jsx` (OAuth-return effect ~86-100)
- Test: `tests/test_note_sync_router.py`, `ConnectedAppsCard.test.jsx`

**Interfaces:**
- Produces: on ANY state failure in the callback (a bad, tampered, expired, wrong-provider, replayed or non-ASCII state from `_verify_state`, or `user is None`, or a session user different from the state's), the callback returns `_oauth_state_failure_page(provider)` with **status 400** and `text/html`. The body is identical for every one of those causes; the indistinguishability of the old JSON 400 is preserved. `_verify_state` itself is unchanged. "missing code/state" stays the JSON 400, and the 503 for no secret is unchanged.
- Page copy, decided here; `{label}` = `registry.get_entry(provider).label`, HTML-escaped, and `{min}` = `_STATE_TTL_SECONDS // 60`:
  - `<h1>Couldn't finish connecting {label}</h1>`
  - `<p>The link back from {label} only works in the same browser where you pressed Connect, within {min} minutes, and only once.</p>`
  - `<p>If you started on another device or browser, go back there and press Connect again. To connect from this browser instead, sign in to UCT here and press Connect again.</p>`
  - `<a href="/settings?section=connections&connector={provider}&connected=0&reason=oauth_state">Open Connections</a>`
  - No script, no external assets, no user id, no state echo.
- Produces (frontend): the OAuth-return effect also handles `connected=0`. It reads `connector` + `reason`, sets `returnNotice`, and strips `connector`, `connected` and `reason` with `history.replaceState`. It renders one `role="status"` line above the tiles:
  - `reason === 'oauth_state'`: `Connecting {Label} didn't finish in this browser. Press Connect below to start again here.`
  - any other non-empty reason: `Couldn't connect {Label}: {reason}`
  - none: `Couldn't connect {Label}. Try again.`
  - `{Label}` comes from `NOTE_CONNECTOR_PROVIDERS`, or the raw key when unknown. The `connected=1` path is unchanged.

- [ ] **Step 1: Write the failing tests**

```python
def test_a_cross_device_callback_explains_what_happened_and_how_to_finish(client, monkeypatch):
    # notion env set; state signed for u1; session override -> None (the other device has no session)
    r = client.get(".../notion/callback", params={"code": "c", "state": state}, follow_redirects=False)
    assert r.status_code == 400 and r.headers["content-type"].startswith("text/html")
    assert "same browser where you pressed Connect" in r.text
    assert "section=connections&amp;connector=notion&amp;connected=0&amp;reason=oauth_state" in r.text
    assert "u1" not in r.text and state not in r.text
    assert client.get(".../status").json()["providers"]["notion"]["connected"] is False

def test_every_state_failure_renders_the_same_page(client, monkeypatch):
    # tampered, expired, cross-user, no-session, replayed  ->  identical r.text for all five
```

The existing `test_callback_tampered_state_400`, `_expired_state_400`, `_cross_user_state_is_rejected`, `_with_no_session_is_rejected`, `_replayed_state_is_rejected_on_second_use`, `_state_for_a_different_provider_is_rejected` and `_non_ascii_state_signature_fails_cleanly_not_a_500` assert only `status_code == 400`, so they stay green unedited.

```js
it('an OAuth return that failed in this browser says how to finish, then strips the params', async () => {
  window.history.replaceState({}, '', '/settings?section=connections&connector=notion&connected=0&reason=oauth_state')
  // render; expect text "Connecting Notion didn't finish in this browser. Press Connect below to start again here."
  // expect(window.location.search).toBe('?section=connections')
})
```

- [ ] **Step 2: Run them and confirm they fail**: `python -m pytest tests/test_note_sync_router.py -q` and `cd app && npx vitest run src/pages/journal-2-0/components/connectors/ConnectedAppsCard.test.jsx`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement**: wrap `_verify_state` in `try/except HTTPException` inside the callback and return the page for both the exception and the session-mismatch branch.
- [ ] **Step 4: Run both again**: same commands. Expected: all PASS, including `test_every_oauth_return_lands_on_the_connections_section` and `test_the_oauth_callback_starts_the_first_sync_for_the_source_it_creates`.
- [ ] **Step 5: Commit**: `git commit -m "fix(note-sync): cross-device OAuth return explains what happened and how to finish"`

---

### Task 8: Folder picker: ignore stale listings

**Files:**
- Modify: `app/src/pages/journal-2-0/components/connectors/DropboxFolderPicker.jsx` (`load` ~56-70 and the open-reset effect ~73-82)
- Test: `app/src/pages/journal-2-0/components/connectors/DropboxFolderPicker.test.jsx`

**Interfaces:**
- Produces: a `requestIdRef = useRef(0)`. Every `load(p)` takes `const id = ++requestIdRef.current`, and its `setFolders`/`setError`/`setLoading(false)` apply only if `id === requestIdRef.current`. Closing (`open` becomes false) also bumps `requestIdRef.current`, so a response that lands after close or reopen is dropped. No other behaviour changes.

- [ ] **Step 1: Write the failing tests** (deferred promises via `let resolveA; new Promise(r => (resolveA = r))`)

```js
it('a slower earlier listing never overwrites the folder the member navigated to', async () => {
  // root resolves [Team Notes]; click Team Notes -> deferred A; click crumb "Dropbox" (root) -> deferred B
  // resolve B with [Team Notes, Archive], then A with [2026]
  expect(await screen.findByText('Archive')).toBeInTheDocument()
  expect(screen.queryByText('2026')).not.toBeInTheDocument()
  expect(screen.queryByRole('status', { name: /loading folders/i })).not.toBeInTheDocument()
})
it('ignores a listing that resolves after the picker was reopened', async () => {
  // open -> deferred A; rerender open=false; rerender open=true -> deferred B; resolve B [Fresh], then A [Stale]
  expect(await screen.findByText('Fresh')).toBeInTheDocument(); expect(screen.queryByText('Stale')).toBeNull()
})
```

- [ ] **Step 2: Run them and confirm they fail**: `cd app && npx vitest run src/pages/journal-2-0/components/connectors/DropboxFolderPicker.test.jsx`. Expected: both new tests FAIL (the stale list wins).
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the file again**: same command. Expected: all PASS, including the 12 existing tests.
- [ ] **Step 5: Commit**: `git commit -m "fix(notebook-connectors): folder picker drops stale listings"`

---

### Task 9: Whole-branch verification and the certification note

**Files:**
- Modify: `docs/notebook-connectors/60-user-reliability-certification.md` (known limitation 2, line ~206)

- [ ] **Step 1: Amend limitation 2 in place.** Keep the original sentence as the historical record (the §15 pattern in limitation 1), then append: `Status update (2026-11-01, plan D): Sync now now runs a removal check, rate-limited to once per 10 minutes per source. Explicit trash lists (Notion, OneDrive) sever on that press; other removals record strike 1 and the card says "N notes look removed in <app>; confirming on the next check." A second press at least 10 minutes later, or the nightly pass, confirms.` Note: this doc does not record the "30-60 s Notion search-index lag" the brief cites (grep finds no such line). The lag is handled by design (Task 3 union + rate limit) and is not cited as measured.
- [ ] **Step 2: Backend suite**: `python -m pytest api/services/journal_two/ -q -k note_connectors` and `python -m pytest tests/test_note_sync_router.py tests/test_note_sync_scheduler_wiring.py -q`. Expected: all PASS.
- [ ] **Step 3: Frontend, by path**: `cd app && npx vitest run src/pages/journal-2-0/components/connectors/ src/pages/journal-2-0/hooks/useNoteConnectors.test.js src/lib/swallowedFetch.census.test.js src/pages/command/keyListenerCensus.test.js src/lib/persistence/persistenceManifest.test.js`. Expected: all PASS, and the file count printed is greater than 0 for each path.
- [ ] **Step 4: Build**: `cd app && npm run build`. Expected: exit 0.
- [ ] **Step 5: Commit**: `git commit -m "docs(notebook-connectors): certification limitation 2 superseded by Sync now removal check"`

---

## Self-review

- **Spec coverage:** §7 removal on press (Task 3), card pending copy (Task 6), guards kept (Global Constraints + Task 3 refuse test), rate limit (Task 3), Notion lag (Task 3 lag test + union rule). §8.1 → Tasks 2, 4, 6. §8.2 → Task 6 `Unchanged`. §8.3 → Task 8. §8.4 → Task 7. §8.5 → Tasks 4, 5, 6. §15 Q4 → Task 3 (one press for explicit lists, strike 1 + copy, the 10-minute rule via the stamp, nightly confirms). The §8 Obsidian Server URL item is shipped with the plugin release (§5.3 I-8) and is out of plan D's scope.
- **Type consistency:** `removalCheck` keys are `{ran, reason, nextAllowedAt, pending, severed}` in Tasks 3, 4 and 5. `LogRow` is the same in Tasks 4, 5 and 6. `pendingRemoval`/`lastFailureCount` are the same in Tasks 4, 5 and 6. `member` kwarg is the same in Tasks 2, 3 and 4.
- **One guard per invariant:** the strike gap and the rate limit are the same mechanism (`last_full_sync_at`, stamped inside delete detection's transaction), mutation-proved in Task 3 Step 5.
