# RESUME: connector fidelity

The program state of connector fidelity: Plans A to F. It is the single place a fresh session reads
first, and where Plan F's before/after numbers are recorded (Plan F rollout step 6). Spec:
`docs/superpowers/specs/2026-11-01-connector-fidelity-and-evernote-design.md`.

⛔ A line here is a dated claim. Before acting on a state below, check it against
`git log origin/master` and the live service.

## Plans

| Plan | What | State (as recorded) |
|---|---|---|
| A | Connector engine fidelity: the remote-revision gate, timestamp-neutral writes (`engine._apply_resolved_body`), the ONE "edited" predicate (`import_provenance.edited_since_import`), `media_policy`, the media-fetch door, the link heal pass, `linkify`, the `importNotice` node | Live: `#650` (2026-11-01), `#669` / `#677` (2026-11-02) |
| B | File importer fidelity: `import_confirm(..., guard_edits=True)`, recover mode, the `imported_at` stamp on the finalize PUT, "Re-import to recover missing pictures and links" | Live: `#678`, `#685` (2026-11-02) |
| C | Obsidian plugin attachments and the provider rewrite (`feat/connector-fidelity-c-server`) | Merged to master as PR `#703` (`8fbf76c6ee`), seen 2026-11-02 while Plan F was in build. Deploy state: check before relying on it. |
| D | (see the spec) | Live: `#642` |
| F | Repair of notes members already imported (`api/services/journal_two/import_repair/`, `tools/note_import_repair.py`) | In build on `feat/connector-fidelity-f-repair`, not merged. Runbook: `docs/runbooks/note-import-repair.md`. Gate `NOTE_IMPORT_REPAIR_ENABLED`: pending (`docs/feature_flags.json`). |

### Plan F: what has to happen before it runs
1. Merge F1 (server, Tasks 1-9) and F2 (UI). Plan F touches `db.py`, `account_purge.py` and the
   generated `docs/account-deletion-manifest.md`, and Plan C merged first. So F rebases onto master
   and re-runs `python tools/account_deletion_manifest.py --write` (never hand-merge the count line).
2. The 2026-11-03 01:47 ET nightly ran: the first full connector pass after the converter merge.
3. A dry run on the pod (runbook step 2). The owner approves the numbers. Record them below.
4. Arm, apply (first on the owner's own account), disarm (runbook steps 4-6).
5. Re-run the dry run and record the after numbers below.
6. `--obsidian-relist` only once Plan C is deployed (C10); a separate, later apply.

## Plan F: before and after

Fill in from the reports (`/data/import_repair/*.json`). Counts and ids only; never titles or text.

| Measure | Dry run before (date, run id) | Dry run after (date) |
|---|---|---|
| `sourcesNotFullSyncedSinceConverter` | | |
| `totals.members` / `notesScanned` / `tooLargeToScan` | | |
| `totals.byClass` | | |
| `totals.byShape` (unedited / edited, per shape) | | |
| `totals.wouldRepairNotes` | | |
| `totals.hotlinksToFetch` | | |
| `totals.keptEdited` / `legacyFinalize` / `unreadableStamp` | | |
| `totals.lostLinks` | | |
| `totals.noticeMembers` | | |
| `peakRssMb` | | |

Apply runs:

| Date | Run id | Members | repaired | raceLost | failed | fetched | fetchFailed | fetchDeferred | busyMembers | leaseLost | Exit |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | |

## Open items
- Undo-copy retention: runbook step 10, after the owner signs the run off.
- Files a stopped run may leave on a member's storage: runbook step 12, owner-approved cleanup only.
