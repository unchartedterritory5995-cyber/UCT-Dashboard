# COV-06 — version history on user-authored artefacts

Branch `lane/cov-06-versions` (from `integrate/terminal-fixes` @ `ee17bc1652`). 2026-10-01.
Flag: `ARTIFACT_VERSIONS_ENABLED`, registered `pending` in `docs/feature_flags.json`. Not armed.

## 1. Re-measured before-state (the roadmap row was not trusted)

The capability matrix said: "Notebook notes have version history; watchlists, saved screens and
workspace layouts have none". Read on this branch:

| Artefact | Store | Restorable history before COV-06? | Evidence |
|---|---|---|---|
| Notebook notes | `j2_notes` | YES | `NoteHistoryPanel.jsx` (not touched) |
| /charts working board | `auth.db user_preferences` keys + `workspace_docs.db` | **YES**, so the matrix was stale here | TERM-021 `workspace_doc_store.py` versions exactly `WORKSPACE_PREF_KEYS` (layout, groups, chart/widget settings, theme, active-template pointer, watchlist columns) for one board, `charts`. TERM-051 `VersionHistory.jsx` is the restore UI. `WORKSPACE_DOC_STORE_ENABLED` is armed on web. |
| Named chart layouts | `charts_layouts.db` (`charts_layout_service.py`) | **NO** | `upsert` overwrites `layout_json` with `UPDATE`; `delete` is a hard `DELETE`. TERM-021 stores only the *pointer* `charts_active_template` (`{id,name,scope}`), never the layout row. |
| Saved screens | `auth.db screener_saved_screens` (`screener/saved_screens.py`) | **NO** | `update` overwrites `spec_json`; `delete` is a hard `DELETE`. (Note: indicator *user definitions* (`user_definitions.py`) are a separate, already append-only store with `/history`; they are formulas, not saved screens.) |
| Watchlists | `auth.db watchlists` / `watchlist_items` | **NO** | `watchlist_service.py` UPDATEs and DELETEs in place. TERM-021's `watchlist_columns` is the column layout, not the list's membership. |

Also measured: today the UI never overwrites a saved screen's spec (only create, rename, publish,
delete); the PUT route accepts `spec` but nothing calls it with one. Named layouts, by contrast,
**auto-save ~400 ms after every arrangement change** (`ChartsWorkspace.jsx` `runNamedSave`).

## 2. What was built

**Store (reuse decision).** The TERM-021 store FILE is reused, its document table is not.
`artifact_versions` and `artifact_version_prune_log` are new tables inside `workspace_docs.db`;
the path is read from `workspace_doc_store._DB_PATH` at call time, so the rows ride the backup
`store_backup.STORES` already takes of that whole file. `workspace_doc_versions` was not bent to
fit: its document model is the board's closed key set (railed against the client source), its
retention is 30 days / 200 deep, and its flag is armed in production, so changing its validation
or retention would have changed a live store under a dark ticket.

**Model.** One append-only row per version, keyed `(user_id, kind, artifact_id, version)`. The
payload is the artefact's own stored TEXT, verbatim:
- `screen`: `{name, spec_json}`. Publication (`is_public`, `share_token`) is not content, so a
  restore never re-publishes a screen its owner unpublished.
- `layout`: `{layout_json, groups_json}`. The name is not content, because it is UNIQUE per member
  and restoring an old one could collide. `label` records it for display.

**Rules.**
- A snapshot is taken on every committed save (`saved_screens.create/update`, user-scope
  `charts_layout_service.upsert`). A save byte-identical to the head appends nothing.
- Pre-write baseline: if the value a save replaced is not the head (the artefact predates arming,
  was saved while dark, or a hook failed), that value is appended first as `baseline`. So the
  first save after arming can already be undone.
- Restore is `POST .../restore {version, base_version}`, compare-and-set; a stale base is 409 and
  nothing is written. It writes the old payload back through the artefact's own store and appends
  it as a NEW version (`source=restore`, `restored_from=N`). Nothing is removed, so restoring the
  version before it undoes a restore.
- Retention (the only row removal, in `_prune`, only while armed, every removal logged):
  (1) a `save` that was superseded by the next `save` within 60 s is coalesced away. A
  `baseline`, a `restore`, and the save a restore replaced are never coalesced. (2) Of what is
  left, the newest 10 are kept (Bloomberg MNRS). ⚠️ Coalescing departs from a literal "snapshot
  on every save, keep 10". Without it, ten auto-saved widget drags would push out the whole
  history. The cost is that a state which lasted under 60 s before the next save is not kept.
- A hook failure never fails the member's save. It is counted (`stats()`) and logged, and the
  next save's baseline step fills the gap.
- Dark means `record_save` returns before any I/O (the one write gate), every route returns 404,
  and no file is opened or created.

**Routes** (`api/routers/artifact_versions.py`, plain `def`): `GET /api/artifact-versions/status`
(the UI probe), `GET /{kind}/{id}`, `GET /{kind}/{id}/{version}`, `POST /{kind}/{id}/restore`.
They are owner-scoped: an artefact that is not yours returns 404, even for an admin, and a
prebuilt (global) layout has no history. Screens are paid content, so a free caller gets 402.

**UI.** One shared component, `app/src/components/artifactHistory/ArtifactHistory.jsx`.
- Screener › My screens: a clock button per row opens History. "Save the current filters into"
  a screen is offered only inside History, so an in-place overwrite exists only where it can be
  undone.
- /charts Layout Dock: the right-click menu on one of your own layouts gains "Version history".
- Both controls are hidden unless the status probe answers 200.
- Restoring the layout you are in re-applies it to the board WITHOUT the switch flush
  (`applyTemplate(row, {skipFlush:true})`). Otherwise the flush would save the replaced board
  over the restore. `useChartLayouts` gained `adoptRow` so no extra request is made.

**Member data rules kept.** No read path writes. Restore is an explicit POST. The TERM-010 STATE-2
rule is untouched (`autosaveLayout`/`isUnreadableStoredLayout` not modified), and the charts suite
is green.

## 3. Tests

```
python -m pytest tests/test_feature_flag_ledger.py tests/test_async_routes_do_not_block.py tests/test_artifact_versions.py -q
  -> 269 passed in 70.32s
  (+ tests/test_charts_layout_service.py tests/test_charts_layouts_share_router.py -> 300 passed)
npx vitest run src/pages/charts/ --maxWorkers=2                    -> Test Files 107 passed; Tests 1133 passed
npx vitest run src/pages/screener/ src/components/artifactHistory/ -> Test Files 40 passed; Tests 359 passed
npx vitest run src/hooks/pollingSites.rail.test.js src/components/ui/ (+ provenance, reachable) -> 20 files, 408 passed
```

`tests/test_artifact_versions.py` (12) uses real seeded stores: the sandbox auth.db, plus
`charts_layouts.db` and `workspace_docs.db` in tmp, with an injected clock. Frontend:
`ArtifactHistory.test.jsx` (7), `LayoutDock.history.test.jsx` (3),
`ChartsWorkspace.artifactHistory.test.jsx` (1), `ScreensManager.history.test.jsx` (2).

Pre-existing reds, not caused by this lane:
- `tests/test_screener_saved.py::test_every_valid_op_declares_its_operands`: `not_in` has no
  `OP_OPERANDS` entry.
- `src/__tests__/entryExcludesChartEngine.test.js` (2): the chain runs `usePreferences.js` →
  `chart/instanceShape.js` → `chart/engine/legacyCotGroups.js`.

## 4. Mutation proofs

Each mutation was made with an editor, run, and restored with an editor.

| # | Mutation | Result |
|---|---|---|
| M1 | `applyTemplate` always flushes (`!skipFlush \|\| true`) | `ChartsWorkspace.artifactHistory` RED: the replaced board `['c1','w1']` was saved over the restore |
| M2 | pre-write baseline disabled | `test_a_screen_saved_before_arming_gets_its_old_value_as_a_baseline` RED |
| M3 | coalescing also drops a save superseded by a restore | `test_a_restore_and_the_state_it_replaced_are_never_coalesced` RED |
| M4 | dark gate in `record_save` removed | 2 RED (dark route rail, direct gate rail). On the first try M4 stayed GREEN because the services also checked the flag: two guards. The services' copy was then removed for layouts and relabelled read-avoidance for screens, and a direct rail was added. |
| M5 | LayoutDock menu entry without `historyAvailable` | `dark: no Version history entry on any layout` RED |

The AST rail `test_the_only_row_removal_is_retention_and_nothing_is_updated` strips docstrings
before it hunts for literals.

## 5. Open

- ~~Watchlists have no history.~~ Done in the follow-up lane, §6.
- ~~Nothing restores a deleted artefact.~~ Done in the follow-up lane, §6.
- Not built: a deleted artefact's tombstone is kept only up to the newest-10 depth of its own
  history (it is always the newest row, so it survives until the artefact is brought back and
  saved 10 more times). There is no age-based expiry and no "empty the bin" action.
- The phone/coarse-tablet charts shell (`MobileChartsApp`) has no History door (the same gap
  TERM-051 has).
- Arming is an owner decision. Nothing technical blocks it, and `workspace_docs` is already in the
  nightly backup.
- `capability-matrix.md` row COV-06 still says the workspace board has no history. That has been
  wrong since TERM-021/051; this report is the correction.

## 6. Follow-ups (branch `lane/cov-06-10-followups`, from `integrate/terminal-fixes` @ `c5b4091188`)

Still dark behind `ARTIFACT_VERSIONS_ENABLED`. No new table: both follow-ups ride
`artifact_versions` (a new `kind` and a new `source`), so `address_space.EXEMPT` needs nothing
beyond the `artifact_versions` line the integrator is adding.

**Watchlist history** (`kind='watchlist'`, `api/services/watchlist_service.py`). A version is a
snapshot of the WHOLE list, `{name, description, items_json}`, where `items_json` is
`[{sym, notes}]` in display order. It is taken after every committed edit: create, add, bulk add,
remove, reorder, note, rename. A duplicate add or a publication change records nothing. The same
`_prune` applies, so a burst of edits within 60 s collapses to its last state and the newest 10
are kept. Each public write is now the unversioned write plus the snapshot, which never raises
into the member's edit. A list built while dark gets its old membership as a `baseline` on its
first armed edit. Lists whose contents are not the member's own are not versioned: the flagged
shadow list (a sync of the flags), an admin INDEX list (curated, up to ~1,900 rows), and a
LINKED list (TERM-077: its source is authoritative). Restore rewrites name, description and
membership; a surviving symbol keeps its item id; publication is untouched.

**Deleted artefacts: tombstone, chosen.** Before this lane the history did outlive a delete
(nothing deleted `artifact_versions` rows), but only if the artefact had been saved while armed.
A screen saved before arming and deleted afterwards left nothing. I chose to KEEP a tombstone:
a delete while armed calls `record_delete`, which appends the removed content as a `baseline` if
it is not already the head, then a `delete` row with the same payload. Why: (1) it is the only way
a never-versioned artefact is recoverable; (2) it records WHEN it was deleted, which the
Recently-deleted list shows; (3) it costs one row and no new table. A `delete` head is not "the
current content", so the save after it (the undelete) always appends.

- `GET /api/artifact-versions/{kind}/deleted`: my artefacts of that kind that have a history and
  no longer exist (existence is the artefact store's fact). Reading a deleted artefact's history
  is allowed because history rows are keyed by their owner.
- `POST /{kind}/{id}/undelete {version, base_version}`: compare-and-set like restore; 409 if the
  artefact exists again. It recreates the artefact under its OLD id (autoincrement ids are never
  reused; list ids are uuids), so its history continues, then records a `restore` row. A screen or
  list comes back unpublished. A layout comes back unshared: a share link that was live at the
  delete is revoked by an appended row first, since `resolve_share` would otherwise revive it. Its
  name is the version's label, with " (restored)" if the member has used the name since.
- UI: `RecentlyDeleted.jsx` (Bring back = the newest version; "Earlier versions" opens
  `ArtifactHistory` in `deleted` mode, where every row is "Bring back") in the Screens menu, the
  Layout library and Watchlists → My Lists. A list's header menu gains "Version history". All of
  it is hidden unless the status probe answers 200, and a dark board makes no `/deleted` request.

Tests (totals lines read in full):

```
python -m pytest tests/test_feature_flag_ledger.py tests/test_async_routes_do_not_block.py tests/test_address_space.py \
  tests/test_artifact_versions.py tests/test_artifact_versions_followups.py tests/test_charts_list_sources.py \
  tests/test_charts_list_subscribe_flag.py tests/test_watchlist_copy_or_link.py tests/test_watchlist_add_item.py \
  tests/test_watchlist_list_bulk_items.py tests/test_charts_layout_service.py tests/test_charts_layouts_share_router.py -q
  -> 1 failed, 388 passed. The one red is test_address_space: ['artifact_versions'] has no EXEMPT line,
     which is the integrator's separate fix (this lane adds no table).
npx vitest run src/pages/charts/ --maxWorkers=2 -> Test Files 109 passed (109); Tests 1166 passed (1166)
npx vitest run src/hooks/pollingSites.rail.test.js src/components/ui/ src/components/artifactHistory/ src/pages/screener/ \
  src/pages/Watchlists src/pages/ThemeTrackerPage --maxWorkers=2 -> Test Files 68 passed (68); Tests 595 passed (595)
```

Mutations (each made with an editor, run, restored with an editor):

| # | Mutation | Result |
|---|---|---|
| F1 | a `delete` head counts as current content (`_record`) | first GREEN: no rail brought back the tombstone's own content and then read the history. Rail added (`test_a_deleted_watchlist_…`: the undelete must append v5 `restore` from 4); then RED |
| F3 | `is_versionable` ignores LINKED lists | `test_flagged_prebuilt_linked_…` RED |
| F4 | layout undelete skips the share revocation | `test_a_deleted_layout_comes_back_unshared_…` RED (the old link resolved again) |
| F5 | Recently deleted posts `base_version: 0` | `RecentlyDeleted.test` and `Watchlists.versions.test` RED |
