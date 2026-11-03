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
