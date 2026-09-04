# Connect UI coherence + first-class-citizenship audit — Notebook connectors

**Date:** 2026-09-04 · **Worktree:** `C:\Users\Patrick\uct-worktrees\notebook-migration`
**Scope (owned files only):** `app/src/pages/journal-2-0/components/connectors/**`,
`app/src/pages/journal-2-0/tabs/NotebookTab.jsx`, and `components/notebook/**` outside `import/**`.
`components/notebook/import/**`, `lib/importer/**`, `api/services/journal_two/note_connectors/**`,
`obsidian-plugin/**` and `docs/feature_flags.json` were read for context only, never edited.
**Method:** file:line tracing + registry/backend cross-check + real `vitest` execution (own fixes),
plus a full run of the existing suite to prove no regression.

---

## PART 1 — Connect UI: what a member can/cannot understand and reach

**Registry parity, verified:** `useNoteConnectors.js`'s `NOTE_CONNECTOR_PROVIDERS` (roam, craft,
notion, dropbox, onenote, onedrive, obsidian) matches `note_connectors/registry.py::_REGISTRY`
name-for-name. No provider is silently missing a tile, and none is falsely offered.

**Dark providers are honestly gated today**, not just documented as such:
`NOTE_SYNC_OBSIDIAN_ENABLED` is unset in prod → `registry._obsidian_configured()` returns
`False` → `ConnectedAppsCard`/`ConnectTilesCompact` both render "Coming soon" for Obsidian, never
a live "Connect" button (`ConnectedAppsCard.jsx:247-248`, `ConnectTilesCompact.jsx:60-61`, both
gated on `providers[key].configured`). Same mechanism covers Notion in prod (no OAuth creds ⇒
`_notion_configured()` False). `docs/feature_flags.json:541` also records the real reason Obsidian
stays dark: `ObsidianConnectModal.jsx` instructs a member to paste a code into "the plugin" — no
published plugin exists yet, so the ledger's own arming condition names this modal's copy as the
blocker. Confirmed the modal is unreachable while dark (same `configured` gate), so the honesty gap
is latent, not live.

**Import vs Connect is legible as one product** (read `ImportWizard.jsx:793-808`, not edited):
the sheet titled "Import notes" shows `ConnectTilesCompact` ("Or connect an app — your notes stay
in sync automatically") directly above "Drop your export here" — the contrast in verbs (`connect`
+ "stay in sync" vs "drop"/"export") carries the one-time-vs-continuous distinction on one screen.

### Fixed (contained, in owned files, tested)

1. **Reconnect was unreachable — a label promising a mechanism nothing could trigger.**
   `SourceRow.jsx`'s `freshnessLabel` has always rendered "reconnect needed" for
   `status === 'broken'`, but the row's only controls were Sync now (re-submits the same broken
   credentials), Pause, and Disconnect — never a way to re-authorize. The backend already supports
   healing without disconnecting first (`connections.upsert_connector` / OAuth callback flip
   `'broken' → 'active'` on a fresh connect, per `connections.py`'s own docstring), so the fix was
   pure wiring, not new backend design: `SourceRow.jsx` gained an `onReconnect` prop rendering a
   "Reconnect" button when `status === 'broken'`; `ConnectedAppsCard.jsx` passes
   `onReconnect={() => openConnect(p)}`, reusing the exact connect flow the initial "Connect"
   button uses. Proven via `ConnectedAppsCard.test.jsx` (new describe block): clicking Reconnect
   opens the token modal and a real `POST /roam/connect` fires with fresh credentials.
2. **Token providers (Roam/Craft) had no one-way/attachments disclosure.** OAuth
   (`ConnectConsentPanel`) and Obsidian (`ObsidianConnectModal`) both told the member "one-way,
   nothing written back" before connecting; `ConnectTokenModal.jsx` had nothing. Verified every
   `NoteProvider` in the registry (`providers/base.py`'s ABC) exposes only `fetch*`/`validate`/
   `list_changed` — no write-back method exists anywhere — so the same disclosure is now honest
   for roam/craft too. Added the matching paragraph; pinned by a new test.
3. **A conflict count with no path to resolve it.** `SourceRow` showed "Conflicts: N" with zero
   indication of what a conflict *is* or where to find it. Traced the engine: a conflict creates a
   normal sibling note, and both sides are tagged `sync-conflict`
   (`engine.py::_reroute_resolved_body_to_sibling`) — the resolution path already exists via the
   Notebook's own tag filter, it was just never named. Added a hint line pointing at the
   `sync-conflict` tag. Not a hover tooltip (touch tier is ≤1024px here) — a persistent line.

### Reported, not fixed (outside owned files)

- **`sourceDeleted` is computed and then dropped on the floor, twice.** `engine.py::sync_source`
  returns `{"sourceDeleted": deleted_count, "deleteDetectionWarning": ...}` (`engine.py:603,605`),
  but `j2_note_sync_log`'s schema (`db.py:1551-1566`, and the duplicate at `db.py:1742-1763`) has
  no column for it, and `_finish_log` (`engine.py:244-267`) never persists it — so `GET /status`
  (`note_sync.py:290-327`, `_latest_sync_counts`) can never surface a deletion count no matter what
  the frontend does. Even the one path where the value reaches the client synchronously (a manual
  "Sync now" response) is discarded — `ConnectedAppsCard.jsx`'s `handleSync` never reads the
  resolved body. **Deletion behaviour is invisible to a member today.** Fix needs a schema column +
  router change, both outside my ownership (`api/services/journal_two/db.py`,
  `api/services/journal_two/note_connectors/engine.py`, `api/routers/note_sync.py`).

---

## PART 2 — Are imported/synced notes first-class?

**Search/tags/folders: first-class by construction, not by per-source special-casing.**
`j2_notes_fts` is populated by unconditional `AFTER INSERT`/`AFTER UPDATE OF title, body_plain`
triggers on `j2_notes` (`db.py:472-496`) — any code path that does a normal `INSERT`/`UPDATE`
(bulk import, connector sync, or a member typing) is indexed identically; there is no
`import_source` branch anywhere in the trigger or in `FolderSidebar.jsx`'s search/tag-cloud code
(server-backed via `useJ2Notes({q})` and `useJ2NoteTags()`, both whole-library, not page-derived).
Folders: synced sources get a real destination folder created on connect
(`note_sync.py::_default_dest_folder_id`). No disparity found.

**No "related notes" surface exists for ANY note** (native or imported) — grep across
`journal-2-0` + `journal_two` is empty. Not a second-class-citizen finding; the capability is
simply absent for everyone.

**No "AI Notebook context / contextual retrieval" system exists today, for anyone.** Nothing under
`api/services/journal_two/coach*.py` or the Compass tool registries reads `j2_notes`
(`grep -rln "j2_notes" api/services` outside `journal_two` returns only `user_playbook`, unrelated).
`AiSearchEmbed.jsx` is a widget an author can drop *into* a note, not a retrieval layer over the
Notebook. Nothing to compare imported notes against — this requirement is currently N/A.

**Genuine second-class finding — ticker/security recognition never reaches synced notes.**
`enrichment.scan_notes_for_tickers` ("the highest-leverage item in the notebook migration program"
per its own docstring) is real and reachable, but ONLY from `ImportWizard.jsx`'s one-time arrival
screen (`ImportWizard.jsx:704`, calling `lib/importer/enrichment.js`). `note_connectors/engine.py`
never calls it (`grep -rn "enrichment\." note_connectors/*.py` is empty). A note that arrives via
an ongoing Roam/Craft/Notion/Dropbox/OneNote/OneDrive/Obsidian sync — which, unlike a bulk import,
has no "arrival screen" moment at all — never gets scanned for tickers and never gets the "want a
live chart?" offer a bulk-imported note gets. This is a real disparity between imported and synced
notes, but the fix spans `lib/importer/**` and `note_connectors/**`, both outside my ownership —
reported, not half-landed.

---

## Tests

`cd app && npx vitest run src/pages/journal-2-0/components/connectors` → **6 files, 79 tests, all
green** (added 8 new tests: Reconnect reachability ×3, one-way disclosure ×1, conflict-hint ×2,
plus 2 negative-case guards). Full `npx vitest run src/pages/journal-2-0` → **153 files, 1388
tests, all green** — no regression from the three fixes above.

## Concerns for the owner

1. Deletion behaviour is a real gap a member can't see (Part 1, reported above) — worth a small
   backend ticket (persist `sourceDeleted` on `j2_note_sync_log`, surface it in `GET /status`'s
   counts, render it in `SourceRow`).
2. Ticker enrichment's absence from the sync path (Part 2, reported above) means the flagship
   "give your old notes live charts" pitch only ever fires once, at import time — a member who
   connects Notion for ongoing sync and writes new ticker-mentioning notes there gets nothing.
3. `docs/feature_flags.json`'s Obsidian note says arming requires "a real, published Obsidian
   plugin" to exist — `ObsidianConnectModal.jsx`'s copy is correct only once that ships; recheck
   its wording against the actual plugin instructions at that time.
