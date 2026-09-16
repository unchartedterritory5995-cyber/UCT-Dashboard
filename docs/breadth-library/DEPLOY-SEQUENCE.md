# BREADTH MULTI-UNIVERSE DARK FOUNDATION — the deploy sequence

⭐ **What this deploy IS:** the universe-keyed schema, the one publication gate, the
daily forward seal and the BL-028 rollback interlock, shipped to production with **UCT
as the only universe that exists** and **nothing member-visible changed**.

⛔ **What this deploy IS NOT:** it does not ingest US, it does not publish any universe,
it does not arm any flag, and it does not drop the compatibility index. Those are the
NEXT phase, and each is a separate decision.

---

## 0 · The gate this deploy is conditional on

| | |
|---|---|
| frontend A/B | **0 new failures** — the 9 failures across 8 files are the same 8 files that fail on clean `origin/master` `65899a8f7` |
| backend, branch | **215 failed / 24,866 passed** (merged tree, `-p no:randomly`) |
| backend, master `65899a8f7` | **230 failed / 24,600 passed** — a clean master worktree fails MORE, because it has no built `app/dist` artifacts |
| the migration, rehearsed on the REAL production database | **7/7** — see §2 |

### The only five tests that fail on the branch and not on master

Set-differenced from the two full runs, then each one answered individually:

| test | verdict |
|---|---|
| `test_breadth_daily_ohlc::test_build_breadth_bars_uses_store_for_wicks` | ⛔ **mine** — poisoned bars cache left by my own fixture. **Fixed** (BL-032) |
| `test_feature_flag_ledger::test_every_off_by_default_gate_is_declared` | ⛔ **mine** — `BREADTH_UNIVERSE_BACKFILL_ENABLED` undeclared. **Fixed** |
| `test_flow_worker_watch_coverage::test_this_branch_does_not_strand_a_change_flow_worker_runs` | ⛔ **mine** — the schema change would ship inert to flow-worker. **Fixed** |
| `test_mutation_check::TestVerdicts::test_a_detected_mutation_passes_the_check` | ✅ **pre-existing** — fails identically on clean master in isolation ("already failing before this ran"); which of the file's three cases lands red is run-order dependent |
| `test_signature_scan_bounds::test_two_cold_builds_are_PACED_apart_lane_wide` | ✅ **pre-existing** — a wall-clock pacing assertion (`0.235s >= 2 x 0.12`); fails on clean master in isolation too |

⚠️ **Two of the five were proved pre-existing by RUNNING THEM ON CLEAN MASTER, not by
reading their names.** A full-suite diff cannot settle an order-dependent or
timing-dependent test, because the two runs are not the same experiment — only an
isolated control on the other tree can.

✅ `tests/test_corp_actions_census.py` fails 3 cases on **both** trees. On the branch it
named two files; `breadth_pit_frame.py` is now registered, and the survivor is
`wisdom/capture/families/gex.py`, which is unregistered on `origin/master` too.

---

## 1 · Deploy order, and why it is this order

Railway does not update the services atomically, so there is always a window with one
pod on new code and one on old. The rolling-deploy audit exercised all four combinations
against real SQLite using master's **actual deployed SQL**:

| window | verdict |
|---|---|
| worker NEW → web OLD (migrated snapshot, universe-blind merge) | **safe** — the extra column is ignored, and while US is absent every row is UCT |
| worker OLD → web NEW (unmigrated snapshot, universe-aware merge) | **safe** — a snapshot with no `universe` column merges as the literal `'uct'` |
| OLD code on an ALREADY-MIGRATED volume | ⚰️ **fatal without the interlock**, **safe with it** |
| a second universe present in any of the above | **cannot happen** — the interlock refuses the write |

⭐ **Both forward windows are safe PRECISELY BECAUSE US IS ABSENT.** That is not a
coincidence to be grateful for; it is the reason this deploy is dark, and the reason
ingest is a later phase.

**The order therefore does not matter for correctness** — which is the point of having
measured it rather than assumed it. Ship it as one push and let Railway sequence the
three services.

⚠️ **But flow-worker must actually receive it.** flow-worker RUNS
`breadth_daily_ohlc`, `breadth_monitor`, `breadth_universes` and `massive`, and watches
none of them, so without a watched-file touch the schema change would ship **inert**
there. `api/flow_worker_main.py`'s header carries the dated trigger;
`tests/test_flow_worker_watch_coverage.py` is the rail that proves it.

---

## 2 · The migration, rehearsed on the real production database

A copy of the exact snapshot production was serving
(`breadth_ohlc/latest.txt` → `snap/1789472774.tar.gz`), migrated by this branch's own
`_ensure_init`:

| | |
|---|---|
| pre-migration | 170,545 rows · 2008-01-02 … 2026-08-07 · `PRIMARY KEY (date, metric)` · no `universe` column |
| migration | **1.03 s**, 43.0 MB |
| **A** the key is widened | `universe` present, row count unchanged |
| **B** every UCT value is byte-identical | `c7578ff928440901…` before **==** after, over 170,545 rows |
| **C** the compatibility index is created on the same boot | `idx_bdo_compat_date_metric` |
| **D** pre-migration code can still write | master's `ON CONFLICT(date, metric)` UPSERT **matched and updated in place** — one row, not a duplicate |
| **E** a `universe='us'` write is REFUSED | `CompatIndexBlocksUniverse` |
| **F** the refused write left nothing behind | fingerprint returns to `c7578ff928440901…` |
| **G** re-running init is idempotent | second `_ensure_init` = **0 ms**, no change |

**D and E are the same index doing both of its jobs**, which is why it is one object and
not two.

---

## 3 · Rollback

| | |
|---|---|
| **code** | revert the merge. ⭐ **This alone is now sufficient**, because D above holds: master's UPSERT still matches an index on the migrated volume. That was the whole reason BL-028 exists. |
| **data** | `rollback/prod_1789472774.tar.gz` · sha256 `5518974638daef7b…` · 8.1 MB gz / 41.7 MB · pre-migration · fingerprint `c7578ff928440901…` |
| ⚠️ **installing the data** | **there is still no supported restore path** — the R2 bridge is an additive gap-fill merge that never replaces a file. BL-030 designs the path (`data_sync.download_snapshot`'s idiom, minus the stale-inode step breadth does not need). It is **not built**, and it is **not needed for this deploy** — it is a precondition of *ingest*, because once the interlock is dropped a bad ingest can only be undone by replacing the file. |

---

## 4 · What must be true before the NEXT phase (US ingest)

In this order, and none of them is implied by this deploy:

1. **every** production pod runs universe-keyed code (web, worker, flow-worker, bars-api);
2. a **working restore path** exists (BL-030);
3. `breadth_daily_ohlc.drop_compat_index()` is called **deliberately, once, out loud**;
4. `BREADTH_UNIVERSE_BACKFILL_ENABLED` is armed — declared `dark` in
   `docs/feature_flags.json` with exactly these preconditions written into it;
5. and **storing is still not publishing** — `BREADTH_LIBRARY_UNIVERSES` is a separate
   decision again.

⛔ Steps 3 and 4 are explicitly **out of scope for this session** by the owner's own
instruction.
