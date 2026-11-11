# Runbook: repairing notes members already imported (connector fidelity Plan F)

Tool: `tools/note_import_repair.py`. Code: `api/services/journal_two/import_repair/`.
Plan: `docs/superpowers/plans/2026-11-02-connector-fidelity-f-repair.md`. Program state:
`docs/notebook-connectors/RESUME-connector-fidelity.md`.

What it does: fixes the known-broken link and image shapes earlier imports left in members' notes.
It works one note at a time:
- dead `import-link://` marks;
- `%xx` Obsidian keys;
- relative note hrefs in file imports;
- bare URLs;
- still-hotlinked images, copied into our storage;
- pictures and files that never came over, which get a visible "didn't come over" marker naming
  the way back (Re-import to recover).

The rules it never breaks:
- **It never writes a note the member edited since its import.** That is the one guard
  (`runner.hands_off`), plus an optimistic lock on the listed `updated_at` and a hash of the body
  it planned from.
- **Every write is timestamp-neutral** (`engine._apply_resolved_body`): `updated_at`, `imported_at`
  and versions are untouched.
- **The dry run comes first, and it is the default.**
- **It never deletes anything:** no SQL DELETE, no file removal (railed by
  `test_import_repair_no_delete.py`).
- **The old body of every note it writes is committed to the log BEFORE the write**: that is the
  undo copy.

## Where and how it runs

**On the web pod, from a separate process, outside 9:30-16:00 ET.**
- `auth.db` lives only there; a local copy would put member notes on a PC (spec §11 forbids it).
- The process never imports `api.main`, holds one note body in memory at a time, and runs under
  `nice -n 19` with `--sleep-ms` between notes.
- ⚠️ History: the web pod went down from out-of-memory twice on 2026-08-28 (a heavy job on the
  pod). That is why the run bounds itself in code, below, rather than by someone watching it.
- `heavy_lock.py` is the PC's lock and does NOT apply on the pod.

Bounds in code (C8):
- **RSS watchdog.** Every 25 notes, memory more than 250 MB above the start aborts the run with
  exit code 4. This applies to the dry run as well as `--apply`. Finished members stay done, and
  the run resumes with the same `--run-id`.
- **Batches.** `--max-members N` and `--max-notes N`; a batch counts only notes still needing work.
  The FIRST apply runs on the owner's own account: `--member <owner user id>`.
- **Market hours.** The dry run and `--apply` both refuse 9:30-16:00 ET on a weekday (exit 2).
  `--apply` also re-checks before each member, stopping cleanly (`stoppedForMarketHours: true`).
  `--allow-market-hours` overrides it; don't use it on the pod.
- **No extraction in the repair process.** A repaired image or file gets its searchable-document
  row created `pending`; extraction and OCR never run in this process. The web pod's sweep
  (`j2_doc_pending_sweep`, every 10 minutes, at most 20 per tick, through the same bounded pool)
  picks the rows up.
- **Downloads.** Hotlink fetches are strictly sequential and capped by `--max-fetches`.
  `media_policy` caps decoded pixels (`MAX_DECODE_PIXELS = 50_000_000`, checked on the header) and
  runs at most 2 decodes at once (`DECODE_CONCURRENCY`).
- **One run at a time.** An exclusive `flock` on `/data/.note_import_repair.lock` (exit 3), plus a
  per-member lease in the database: a member another live runner holds is skipped and counted
  `busyMembers`.
- **Record the cost first.** Record `peakRssMb` from a real dry run on the pod BEFORE the owner is
  asked to arm.

Exit codes:

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | an unexpected error outside a single note's handling (a traceback in the log), e.g. "database is locked" while claiming a member. Nothing is half-written; re-run with the same `--run-id` |
| 2 | refused: flag off for `--apply`, or market hours |
| 3 | another run holds the lock |
| 4 | memory ceiling reached: the run aborted itself, resumable |
| 5 | `auth.db` missing |

The Obsidian re-list (`--obsidian-relist`) is OFF unless passed (C10). Pass it ONLY after connector
fidelity Plan C is merged and deployed; before that, a re-list converts once with the old converter
and never again.

## Before the deploy: count the stale pending documents (read-only)

The same deploy adds the web pod's `j2_doc_pending_sweep`. It re-queues `pending` searchable-document
rows that were NEVER extracted (`processed_at IS NULL`) and are older than 10 minutes, 20 per tick,
first tick no sooner than 10 minutes after boot. A `pending` row with `processed_at` set is a document
already extracted and waiting for OCR; the sweep never touches it. Production may already hold rows a
crash or redeploy left `pending` since Wave I. Record their number first:

```
railway ssh --service web
/opt/venv/bin/python -c "import sqlite3; c = sqlite3.connect('file:/data/auth.db?mode=ro', uri=True); print(c.execute(\"SELECT COUNT(*), MIN(created_at) FROM j2_note_documents WHERE status = 'pending' AND processed_at IS NULL AND created_at < strftime('%Y-%m-%dT%H:%M:%S', 'now', '-10 minutes')\").fetchone())"
```

(`created_at` is stored as ISO text with a `T`, so the cutoff is built in the same shape.) At 20 rows
per 10 minutes, N rows take N/2 minutes to drain. A row the sweep cannot finish after 3 tries is
marked failed, never retried forever.

Kill switch: `NOTEBOOK_DOC_PENDING_SWEEP_DISABLED=1` on `web`. The sweep reads it at each tick, but
from the PROCESS environment, and a Railway variable change reaches the process only on a new boot.
So a change takes effect after a redeploy, never at "the next tick":

1. Stop: `railway variable set NOTEBOOK_DOC_PENDING_SWEEP_DISABLED=1 --service web`.
   Resume: `railway variable delete NOTEBOOK_DOC_PENDING_SWEEP_DISABLED --service web` (a delete
   never restarts the pod).
2. `railway redeploy --service web --yes`.
3. Confirm from the pod, never from `--kv` (which reads the service, not the process): the
   `/api/health` uptime reset, and `railway ssh --service web` then
   `tr '\0' '\n' < /proc/1/environ | grep NOTEBOOK_DOC_PENDING_SWEEP_DISABLED` prints `=1` after a
   stop and nothing after a resume.

## Before arming: the lock test must pass on Linux

`tests/test_note_import_repair_cli.py::test_second_run_exits_3_while_locked` is POSIX-only and has
not run on the Windows dev box. Run it once on the pod (or a Linux CI) before step 4, and record
that it passed. It MUST pass:

```
railway ssh --service web
cd /app && /opt/venv/bin/python -m pytest tests/test_note_import_repair_cli.py -q -k second_run_exits_3_while_locked
```

## Steps

1. Precondition: the 2026-11-03 01:47 ET nightly ran (`sourcesNotFullSyncedSinceConverter == 0` in the dry run).
2. Dry run: `railway ssh --service web`, then `nice -n 19 /opt/venv/bin/python tools/note_import_repair.py --out /data/import_repair/dryrun-1.json`.
3. Owner review checklist: `byShape` unedited vs edited; `wouldRepairNotes`; `hotlinksToFetch`; `keptEdited` and `legacyFinalize`; `noticeMembers`; `peakRssMb` under 300.
   Also read `byClassShape` (shapes per class), `lostLinks`, `unreadableStamp` and `tooLargeToScan`.
4. Arm: `railway variables --set NOTE_IMPORT_REPAIR_ENABLED=1 --service web` (this redeploys `web`).
   Never assume the redeploy happened: `--set` has been measured both restarting and NOT restarting
   `web` (CLAUDE.md). Confirm a NEW boot (`/api/health` uptime reset), else run
   `railway redeploy --service web --yes` and confirm again. Without a new boot the variable is not
   in the pod's environment and `--apply` exits 2 (it fails safe). Arming restarts `web`, so do it
   outside market hours.
5. Apply: `railway ssh --service web`, then `nohup nice -n 19 /opt/venv/bin/python tools/note_import_repair.py --apply --out /data/import_repair/apply-1.json > /data/import_repair/apply-1.log 2>&1 &`.
   First run: add `--member <owner user id>` and read the result before running for everyone.
6. Kill switch: `railway variable delete NOTE_IMPORT_REPAIR_ENABLED --service web` then `railway redeploy --service web --yes` (a delete alone does not restart the pod; the redeploy ends the run, and `--apply` refuses to start again). Resume later with the same `--run-id`.
   The redeploy kills the process without its cleanup, so the member it was working on keeps its
   lease for up to 10 minutes. Wait 10 minutes before resuming; a resume sooner reports that
   member in `busyMembers` and skips it.
7. After: disarm as in 6; re-run the dry run; writable shapes on unedited file notes should be 0 apart from `fetch_failed` hotlinks and unresolvable pending keys.
   Read it per class (`byClassShape`): zero is expected only for the (class, shape) pairs the runner repairs. Connector notes get link repair only; live and re-listed connector notes are never written. A residual `obsidian_pct_key` count is expected for keys whose decoded form still holds `%xx` and names no note.
8. Known limits of the link repair, accepted (Task 3 re-review N-4). The stored keys of an Obsidian file import do not record where a drop's vaults were rooted (`.obsidian/` is not stored), so two links that the member wrote as exact paths are taken at their word even when the client would have kept them inside one vault:
   - (a) a vault-rooted path inside a multi-vault drop, e.g. `Personal/Plan.md` written in `Obsidian/Work/...`, opens `Obsidian/Personal/Plan.md` (R3);
   - (b) a `..` path from one vault import into another, e.g. `../B/Plan.md` from vault `A`, opens `B/Plan.md` (R2).

   Both are exact paths the member typed; bare names are never resolved across folders or imports. The dry run counts every link that is:
   - resolved;
   - left as written (`relative_ambiguous`, `relative_target_trashed`, `relative_unresolved`, `relative_file_unresolved`, `relative_hostlike`);
   - resolved by name (`relative_by_name`).

   So the owner reviews these numbers before arming.
9. Undo one note (Task 5 review M-5).
   - The undo source for (run, note) is the OLDEST logged body, never the newest (a resumed run can log its own output as a later "before"): `SELECT user_id, before_body_json, created_at FROM j2_import_repair_log WHERE run_id = ? AND note_id = ? AND before_body_json IS NOT NULL ORDER BY id LIMIT 1`.
   - Apply it ONLY through `engine._apply_resolved_body(conn, user_id, note_id, json.loads(before_body_json), expected_updated_at=<the note's current updated_at>, expected_body_hash=engine.stored_body_sha(<the body read when deciding to undo>))`. The hash makes the undo refuse if anything wrote the body after that read, including a timestamp-neutral heal-pass write.
   - An undo leaves the copies the repair stored for that note unreferenced; they are handled as in step 12.
   - Apply it only when the note's `updated_at` has not moved past that row's `created_at`, compared as parsed timestamps, never as strings. The repair does not move `updated_at`; a member edit does, and an undo then would clobber it.
   - NEVER a raw `UPDATE j2_notes SET body_json = ...`: it skips the sidecars (plain text, links, embeds, the media and links pending flags) and the optimistic lock.
10. Retention of the undo copies (Task 5 review).
    - When: only after the owner signs the run off (suggested: 30 days after the apply with no undo request), outside 9:30-16:00 ET, on the pod.
    - Preconditions per run: every member `done` in `j2_import_repair_progress`, and no note whose latest outcome in the run is `repair_started`. Resolve those first: compare the note's body with that row's body, then finish or undo as in step 9.
    - Then null the bodies and keep the audit rows (an UPDATE, never a DELETE), one member at a time with a commit each, so the auth.db write lock is held only briefly: `UPDATE j2_import_repair_log SET before_body_json = NULL WHERE run_id = ? AND user_id = ? AND before_body_json IS NOT NULL`.
    - Do NOT VACUUM auth.db on the pod for this; freed pages are reused.
    - Account purge removes all of it with the member in the meantime.
11. Reading the numbers (Task 6 review M-4, M-5).
    - (a) "Edited" is the shared predicate `import_provenance.edited_since_import` (strict `updated_at > imported_at`), the same one the live importers use. It has two accepted residuals:
      - an edit at exactly the same instant as `imported_at` reads unedited (theoretical with microsecond UTC stamps);
      - the file importer's finalize PUT re-stamps `imported_at = updated_at = now`, hiding an edit made between confirm and finalize. A body edit in that window was already overwritten by the finalize body, and the repair writes only the body, so no member content is at risk; a tags or properties edit there just reads as unedited.
    - (b) `byClass.connector_orphaned` counts every connector-imported note whose provider has no source that is BOTH `status = 'active'` AND `sync_enabled = 1`: a disconnected source, but also one that is `broken` or paused. Those notes get link repair only (timestamp-neutral), never media markers; a broken connector that later recovers is unaffected.
12. Files a stopped run can leave behind (Task 7 review M-9).
    - Why they exist: a hotlink is downloaded and stored BEFORE the note is written. If the run stops between the two (a crash, ^C, the RSS abort, a lost lease, a race the last re-check catches), or the note's write then loses its race, the stored copy is on the member's storage but referenced by no note.
    - The repair never deletes a file, and neither does this runbook: NO manual delete.
    - They are visible: the next dry run counts them per note as `orphan_media`.
    - They are collected by the existing attachment GC (`api/services/journal_two/attachment_gc.py`):
      user-wide references, a 48-hour age gate, and files of notes with pending connector media kept.
      - The nightly job runs only while `J2_ATTACHMENT_GC_ENABLED=1`.
      - Otherwise the admin endpoint `POST /api/j2/notes/attachments/gc` (dry run by default) reports
        what it WOULD remove, with example paths. The owner decides there.
    - Until then the files stay, counted, on the member's storage. Account purge removes them with the
      member in any case.
13. Reading the log.
    - `relist_requested` rows carry the Obsidian SOURCE id in `note_id` (the log has no source column) and the prior cursor in `actions_json` (`prior_cursor:<value>`).
    - A member skipped because another runner held it appears only in `busyMembers`; re-run with `--member <id>` after the other run ends.
    - A hotlink the `--max-fetches` cap deferred is counted in `fetchDeferred`, and its member is left unfinished: resume with the same `--run-id` to fetch the rest.
    - A hotlink that failed to copy (`fetchFailed`) keeps its image and is done for that run; a NEW `--run-id` retries it once more, never again after that. This is per URL: a live hotlink in the same note that the cap deferred is still fetched by a resume with the SAME `--run-id`.
    - `failed > 0`: those notes are not retried in the same run (a transient "database is locked" is the usual cause). Once the run is finished, run again with a NEW `--run-id` (e.g. `...-f2`); it retries them, and every note already repaired reads as unchanged.
