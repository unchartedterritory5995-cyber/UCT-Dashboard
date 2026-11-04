# Flow-worker strand: connector fidelity Plan F (import repair)

**Classification: all four files are INERT STRANDS on flow-worker. No flow-worker redeploy.**

Branch `feat/connector-fidelity-f-repair`. A red from `tools/flow_worker_watch_coverage.py` is a
REVIEW GATE that has to be classified, never ignored (`docs/runbooks/deploy-windows.md`). This is
that review. The same pattern as `docs/breadth/flow-worker-strand-pagecache.md`.

## The check

`python tools/flow_worker_watch_coverage.py` (base `origin/master`). Run on 2026-11-02, and again
after merging origin/master (Plan C, #703) into this branch, with the same result:

```
FAIL - flow-worker RUNS these files but will NOT redeploy for them:
    api/services/journal_two/account_purge.py
    api/services/journal_two/db.py
    api/services/journal_two/document_extraction.py
    api/services/journal_two/import_notice.py
```

## Why each is inert there

flow-worker reaches all four only through the session-cookie fallback: `api.flow_proxy` imports
`api.services.auth_service` for `validate_session`, and `auth_service` imports `auth_db`, which
imports the whole `journal_two.db` module graph at import time. flow-worker never runs
`auth_db.init_db` / `ensure_schema` (its own header, `api/flow_worker_main.py`, says so). It calls
nothing in these four modules beyond importing them. The shortest import chains, computed from the
coverage tool's own AST helpers (`_api_imports`, BFS from `api.flow_worker_main`):

| File | Shortest chain from `api.flow_worker_main` | What changed | Why it is inert on flow-worker |
|---|---|---|---|
| `api/services/journal_two/db.py` | `flow_worker_main -> auth_surface_check -> flow_proxy -> auth_service -> auth_db -> journal_two.db` | `_J2_SCHEMA` gains the three `j2_import_repair_*` tables and their indexes (`CREATE ... IF NOT EXISTS`); `_PHASE_2_ALTERS` gains `j2_note_documents.sweep_attempts` and `failure_reason` | Schema text only, executed by `ensure_schema`, which flow-worker never runs. All additive; an old copy of this file anywhere still reads every row correctly. |
| `api/services/journal_two/document_extraction.py` | `... -> journal_two.db -> template_gallery -> document_extraction` | `on_attachment_saved(queue=)` (default True: unchanged for every caller); `_QUEUED` bookkeeping in `queue_extraction`; `requeue_stale_pending`, `pending_sweep_tick`, the kill-switch read | flow-worker never saves an attachment or extracts a document, and the sweep job is registered only in `api.main`'s lifespan, which flow-worker does not run. Import-time additions are constants, a lock and an empty set. |
| `api/services/journal_two/account_purge.py` | `... -> api.routers.auth -> journal_two.account_purge` (19 hops through the module graph) | `_DIRECT_USER_TABLES` gains the three `j2_import_repair_*` tables | Account deletion runs from the web pod's auth routes only. flow-worker imports the module and never calls the purge. |
| `api/services/journal_two/import_notice.py` | `... -> journal_two.db -> journal_two.notes -> import_notice` | `REPAIR_REASONS = ("missing_from_import",)` appended to `NOTICE_REASONS`, plus its copy line | Data tables only. flow-worker renders no note and writes no notice. |

So: no `api/flow_worker_main.py` header trigger, and no flow-worker redeploy. Forcing one would gap
the OPRA tape for zero behavioural difference.

## Before the deploy: the stale pending-document count (owner runs it, read-only)

The deploy adds the web pod's `j2_doc_pending_sweep`. It re-queues `pending` searchable-document
rows that were never extracted (`processed_at IS NULL`; a `pending` row with `processed_at` set is
waiting for OCR and is never touched) and are older than 10 minutes, at most 20 per tick, with the first tick no sooner than 10 minutes after
boot. A row it cannot finish after 3 tries is marked `processing_failed`. Kill switch:
`NOTEBOOK_DOC_PENDING_SWEEP_DISABLED=1` on `web`. It takes effect only on a new boot: `railway
variable set` (or `railway variable delete` to resume), then `railway redeploy --service web --yes`,
then confirm from the pod (uptime reset, and the running process's `/proc/1/environ`), never from
`--kv`. Full steps: `docs/runbooks/note-import-repair.md`, "Before the deploy".

Production may already hold rows that crashes and redeploys left `pending` since Wave I. Count them
first and record the answer here:

```
railway ssh --service web
/opt/venv/bin/python -c "import sqlite3; c = sqlite3.connect('file:/data/auth.db?mode=ro', uri=True); print(c.execute(\"SELECT COUNT(*), MIN(created_at) FROM j2_note_documents WHERE status = 'pending' AND processed_at IS NULL AND created_at < strftime('%Y-%m-%dT%H:%M:%S', 'now', '-10 minutes')\").fetchone())"
```

At 20 rows per 10 minutes, N rows drain in about N/2 minutes, OCR included for images.

| Date | Count | Oldest `created_at` |
|---|---|---|
| | | |

The same query is in `docs/runbooks/note-import-repair.md`, "Before the deploy".

## 2026-11-03: deleted destination folder fix (`fix/connector-missing-dest-folder`)

`tools/flow_worker_watch_coverage.py` flags `api/services/journal_two/notes.py`. Classification: **flow-worker stranded: ADDITIVE, safe; discharge by marker bump at the next window. No flow-worker redeploy is forced.**

- Flow-worker reaches `notes.py` by exactly one chain: `flow_worker_main` → `flow_router` → `flow_admin_auth` → `auth_service` → `auth_db` → `journal_two/db` → `notes`.
- `db.py` imports only `convert_playbook_to_tiptap` and `extract_plain_text` from `notes`, lazily, inside migration helpers. Neither function changed.
- Flow-worker never calls `delete_folder` or `import_confirm`, and never raises or catches `DestinationFolderNotFound`.
- `dest_folder.py` and `engine.py` are not in its import closure.

## 2026-11-03: Evernote rate-limit fix (`fix/evernote-tool-rate-limit`)

`tools/flow_worker_watch_coverage.py` flags `api/services/journal_two/db.py` and `api/services/journal_two/note_connectors/providers/base.py`. Classification: **flow-worker stranded, ADDITIVE and safe. Discharge with a marker bump at the next window. No forced flow-worker redeploy.**

- `base.py`: flow-worker uses only `_is_disallowed_ip`, which is unchanged. It is reached through `alert_taxonomy.outbound_webhooks`.
- `db.py`: the new nullable column `j2_note_sources.sync_state` and its ALTER run only inside `auth_db.init_db`, which flow-worker never runs.

## 2026-11-03: Evernote slot scheduling (`fix/evernote-slot-scheduling`)

`tools/flow_worker_watch_coverage.py` flags `api/services/journal_two/notes.py`. Classification: **inert strand, no flow-worker redeploy.** flow-worker reaches it by one path, `flow_worker_main` -> `flow_router` -> `flow_admin_auth` -> `auth_service` -> `auth_db` -> `journal_two.db`, and `db.py` imports it LAZILY inside the one-shot Playbook migration (`convert_playbook_to_tiptap`, `extract_plain_text`, both unchanged), which runs only from `auth_db.init_db`, never in flow-worker. The change is inside `import_confirm` (each note's CPU work moved ahead of the write transaction), which flow-worker never calls. `engine.py`, `connections.py` and `providers/evernote.py` are not in its closure.

Final review fix (NEW-A incremental livelock past FETCH_CAP_PER_PASS, NEW-B, NEW-C, the trashed-row `imported_at` guard): the change is in `note_connectors/engine.py` and tests only. `tools/flow_worker_watch_coverage.py` still flags only `api/services/journal_two/notes.py`, from this branch's earlier commits, classified above as an inert strand. `engine.py` is not in flow-worker's import closure. No flow-worker redeploy.

## 2026-11-03: connector note lifecycle (`fix/connector-note-lifecycle`, L1-L4)

`tools/flow_worker_watch_coverage.py` flags `api/services/journal_two/account_purge.py`, `api/services/journal_two/db.py` and `api/services/journal_two/notes.py` (`notes.py` partly from the slot scheduling branch this one is stacked on). Classification: **inert strands, no flow-worker redeploy.**

- `db.py`: `_J2_SCHEMA` gains `j2_obsidian_renames` (L2) and `j2_note_import_media` (L4), both `CREATE TABLE IF NOT EXISTS`, executed only by `ensure_schema` / `auth_db.init_db`, which flow-worker never runs. Additive; nothing else in the module changed.
- `account_purge.py`: `_DIRECT_USER_TABLES` gains those two table names. Reached through `api.routers.auth`; the purge runs from the web pod's auth routes only, and flow-worker never calls it.
- `notes.py`: `_row_to_note` gains the `importSource` key (L3). flow-worker serves no note; `db.py` imports only `convert_playbook_to_tiptap` and `extract_plain_text` from it, lazily, inside the one-shot migration, both unchanged.
- `note_connectors/engine.py`, `obsidian_staging.py`, `obsidian_link.py` and `providers/obsidian.py` carry the behaviour and are not in flow-worker's import closure (the tool does not list them).

Fix round 1 (review of 9af3fae84a): the tool still flags the same three files, still inert. `notes.py` also gains one `DELETE FROM j2_note_import_media` inside `purge_expired_deleted_notes`, the web scheduler's trash sweep, which flow-worker never runs. `providers/base.py` gains a class attribute (`enumeration_is_authoritative = False`); flow-worker uses only its unchanged `_is_disallowed_ip`, and the tool does not list it. The behaviour stays in `engine.py`, `obsidian_staging.py` and `providers/obsidian.py`, outside flow-worker's closure.
