# Journal 2.0 — Note Connectors ("connect once, everything syncs")

**Date:** 2026-08-11
**Status:** Design complete (research-driven; owner triple-approved direction), implementation planned
**Scope:** Account-connected background sync of external note libraries into the Notebook, layered on the shipped file importer. Wave 1: connector framework + Roam + Craft (live day one, user-pasted tokens) + Notion (dark until owner registers the integration) + Dropbox folder-sync (dark until owner registers the app), plus the server-side conversion layer and its cross-language schema rail.

---

## 1. Motivation & relationship to the file importer

The file importer (spec 2026-08-11-notebook-import) is the universal door — it covers every app that can export. Connectors remove the export-download-drag friction for services with usable APIs: the user connects once, their whole library transfers, and edits keep flowing in the background. Research verdicts (six reports, Aug 2026) fix the tiering:

- **Roam Research** — hosted backend API, user-created read-scoped graph token. Zero registration. LIVE in wave 1.
- **Craft** — Connect API, user-created per-space connection (capability URL + Bearer, read-only scope available). Zero registration. LIVE in wave 1.
- **Notion** — public-integration OAuth2 with refresh tokens, search enumeration, GA webhooks. Built COMPLETE but DARK: activates via env (`NOTION_CLIENT_ID/SECRET`) when the owner registers the free integration.
- **Dropbox folder-sync** — offline OAuth, per-folder cursor + webhook. Covers Obsidian vaults / Logseq / Joplin sync dirs / export folders living in Dropbox. Built DARK behind `DROPBOX_APP_KEY/SECRET`.
- **Evernote** — connector NOT viable (API keys suspended, program deprecated). The shipped `.enex` importer is the permanent answer; the connect screen says exactly that.
- **OneNote / OneDrive / Google Drive / Obsidian plugin / Apple Mac helper / Keep-via-Takeout** — deferred waves; documented in §10 with their gates (Graph 400 req/hr durable queue; CASA ~$3–5K/yr for Drive; separate plugin/helper artifacts).

## 2. Goals & non-goals

**Goals (wave 1)**
- One "Connected apps" surface in the wizard's drop step + Settings: connect Roam/Craft (paste token) and Notion/Dropbox (OAuth) — full initial pull, then scheduled incremental background sync.
- Sync lands through the SAME fingerprint pipeline as the wizard: upsert by `(user_id, import_key)`, unchanged → skipped, re-sync never duplicates. Locally-edited notes are never clobbered silently (§6 conflict policy).
- Per-source freshness/trust UI (last sync, counts, errors, manual "Sync now"), mirroring the broker-sync trust surface.
- Provider tokens encrypted at rest via `crypto_box` (existing Fernet util, versioned keys — `NOTE_ENCRYPTION_KEY*` env family).
- Whole feature inert unless `NOTE_SYNC_ENABLED=1`; per-provider dark until their env creds exist.

**Non-goals (wave 1)**
- Writing back to the source (one-way: source → Notebook).
- OneNote/OneDrive/GDrive providers; Obsidian community plugin; Apple Mac helper; Keep Takeout auto-ingest (all §10).
- Notion webhooks receiver (endpoint scaffolded; polling is the wave-1 freshness mechanism — webhooks are additive later).
- Real-time (<minute) sync; the floor is the scheduler cadence + provider timestamp granularity (Notion rounds to the minute).

## 3. Architecture

```
Settings/Wizard "Connected apps" card
   └─ connect: paste-token form (roam/craft) | OAuth redirect (notion/dropbox)
        └─ POST /api/j2/notes/connectors/{provider}/connect  → validate, encrypt, create source rows
Background: APScheduler (NOTE_SYNC_ENABLED, serial, cron-minute offset from broker jobs)
   └─ sync_due_sources → per-source asyncio lock → provider.pull(cursor)
        └─ provider yields RemoteNote{remote_id, title, tiptap_doc, tags, folder_path,
                                      created/updated, media:[RemoteMedia], links:[remote_id refs]}
        └─ engine: hash placeholder body → import_confirm-shaped upsert (service call, not HTTP)
                   → media download+store (bytes API) → rewrite placeholders → final body update
        └─ cursor advance (overlap-safe), sync log row, remote index update (delete detection)
```

**Provider contract** (`api/services/journal_two/note_connectors/providers/base.py`):
`validate(credentials) -> AccountInfo`; `list_changed(credentials, cursor) -> Iterator[RemoteRef]`; `fetch(credentials, ref) -> RemoteNote`; `provider.capabilities` (supports_folders, supports_media, token_kind). Providers raise the shared taxonomy: `NoteConnNotConfigured / NoteConnAuthError / NoteConnTokenExpired(⊂AuthError) / NoteConnRateLimited(retry_after) / NoteConnTransient / NoteConnUnsupported(reason)` — mirroring the SnapTrade family that drives HTTP codes, status transitions, and notifications.

**Reused wholesale from the broker template** (per the extraction report): crypto_box (new key family), AsyncRateLimiter per provider, per-source `asyncio.Lock` + cooldown + `_LOCKED_RETRY_DELAYS`, cursor-with-overlap, `_start_log/_finish_log` audit bracket, refuse-to-delete guard (delete-detection bails if a listing covers <50% of the known set), serial sync concurrency, scheduler job with `max_instances=1` + cron-minute offset (auth.db contention hygiene), Settings card + trust-surface component shapes.

## 4. Server-side conversion layer — and the schema rail

Connectors run in background jobs; the browser converter (markdown-it + TipTap `generateJSON`) is unreachable. Wave 1 adds `note_convert/` (Python) emitting **TipTap JSON directly**:

- `mddoc.py` — markdown-it-py (the Python port of the SAME parser the wizard uses) token-stream → TipTap nodes: paragraphs, headings 1-3, lists (bulleted/ordered/task via the checkbox syntax), tables (GFM plugin), code blocks, blockquotes, links, emphasis/strong/strike/code marks, images → `import-ref://` placeholders, `<mark>` for highlights.
- `notion_blocks.py` — the ~30-type dispatch table from the research blueprint (pinned `Notion-Version: 2025-09-03`): paragraph/headings(+toggleable→details-as-blockquote+strong per editor capability)/lists incl. grouping/to_do→taskList/toggle→blockquote+strong title/callout→blockquote/quote/code/table+table_row/divider/media→placeholders/synced_block(resolve original, cycle-guarded)/column_list→sequential/child_page+link_to_page→internal link placeholders/equation→code-styled text/`unsupported`→visible `[unsupported block]` paragraph (never silent).
- `roam_text.py` — pre-passes ported from the Obsidian adapter's proven regex order (code-protection first): `[[links]]`→internal link placeholders, `((refs))`→resolved text via pull (bounded, cache), `{{[[TODO]]}}/{{[[DONE]]}}`→taskItems, `^^highlight^^`→mark, `attr::`→plain text, then `mddoc.py`.
- `rewrite.py` — Python port of `commit.js`'s `rewriteBody` (placeholder→URL swap, drop-with-record missing media, unresolved link marks stripped keeping text). Port the exact semantics; its vitest twin's fixtures are shared (below).

**The rail (mandatory, the repo's cross-language-contract lesson):** a build step dumps golden outputs from every Python converter over fixture inputs into `app/src/pages/journal-2-0/lib/importer/__fixtures__/server_convert/*.json`; a vitest test loads EACH through the real editor schema (`getSchema(buildExtensions())` + `Node.fromJSON` — parse must not throw, and a render smoke via generateHTML) and snapshot-pins task-state/table/link semantics. A Python-side hash-parity test pins `_import_payload_hash` against `canonicalJson` fixtures similarly. **CI-red if the two languages drift.**

**Ordering constraints copied from the wizard (load-bearing):** hash is computed over the PLACEHOLDER body before media upload (or every cycle re-updates); remote `updated_at` participates in the hash basis (it IS the change signal). Media lands via new byte-level service functions — `save_note_image_bytes` / `save_note_attachment_bytes` refactored out of the UploadFile paths (UploadFile wrappers delegate; existing routes unchanged).

## 5. Data model (all in `_J2_SCHEMA` + migration v3 guarded exactly like v2 — column-probed, flag `.notebook_migration_v3`, created AFTER v1/v2 calls in `ensure_schema`)

```sql
j2_note_connectors(user_id TEXT, provider TEXT, token_enc TEXT NOT NULL,     -- crypto_box JSON blob
    account_label TEXT, status TEXT NOT NULL DEFAULT 'active',               -- active|broken|disabled
    consent_at TEXT, created_at TEXT, updated_at TEXT, PRIMARY KEY(user_id, provider));
j2_note_sources(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL,
    remote_id TEXT NOT NULL,                    -- graph name / space link id / workspace bot_id / folder id
    display_name TEXT, dest_folder_id TEXT,     -- default: "Roam — {graph}" root folder
    cursor TEXT, sync_enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active', last_sync_at TEXT, last_sync_status TEXT, last_sync_error TEXT,
    warming_until TEXT, created_at TEXT NOT NULL, UNIQUE(user_id, provider, remote_id));
j2_note_sync_log(id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, user_id TEXT NOT NULL,
    started_at TEXT, finished_at TEXT, status TEXT, error TEXT,
    notes_created INTEGER, notes_updated INTEGER, notes_skipped INTEGER, media_uploaded INTEGER);
j2_note_remote_index(user_id TEXT, source_id TEXT, remote_id TEXT, import_key TEXT NOT NULL,
    remote_updated_at TEXT, seen_at TEXT NOT NULL, PRIMARY KEY(user_id, source_id, remote_id));
```

`import_key` formats: `roam:{graph}/{page-uid}` · `craft:{link_id}/{doc_id}` · `notion:{page_id}` (real ids — no stripped-path collision class) · `dropbox:{folder_id}/{path_lower}`. Delete detection: a full enumeration marks `seen_at`; rows unseen for 2 consecutive full syncs → the linked note gets tag `source-deleted` + the source link severed (NEVER auto-delete the note — flag/soft-degrade, the `demote_broker_accounts` instinct). Refuse-to-run guard when enumeration returns <50% of the index.

## 6. Conflict policy (new ground — brokers never had user-editable rows)

On sync update where the local note's `updated_at` > its `imported_at` (user edited locally since last sync): do NOT overwrite. Create/refresh a sibling note titled `{title} (synced copy)` under the same folder carrying the fresh remote body (its own import_key suffix `#remote`), tag both `sync-conflict`, and surface the count in the trust UI. Un-edited notes update in place as normal. This is deliberately simple v1; merge UX is future work.

## 7. Providers (wave 1 specifics, from research)

- **Roam**: token `roam-graph-token-*` + graph name pasted. 308-redirect re-auth handling (requests drops Authorization on redirect — re-attach), 503 cold-start retry ladder. Enumerate `[:find ?uid ?title ?time …]`; `pull-many` batches of 40 with the recursive selector; incremental = re-run enumeration, diff `:edit/time` vs index. Firebase images mirrored at pull. Encrypted graphs: detect (read q fails) → status `unsupported` with the exact message. Daily-notes pages land under folder `Daily Notes`.
- **Craft**: capability URL + Bearer pasted (validated via `GET /connection`; token shown once in Craft — copy asks the user to paste immediately). Full pull `GET /documents?fetchMetadata=true` → per-doc `GET /blocks` `Accept: text/markdown` → mddoc. Incremental via `lastModifiedDateGte=cursor-overlap`. Folders from the folder endpoints when present. No documented rate limits → self-impose 3 rps.
- **Notion** (dark): OAuth (authorize→code→token, HTTP Basic; refresh rotation lock-guarded — concurrent refreshes invalidate each other), `search` enumeration (100/page), block traversal recursing `has_children`, data-source queries for child databases (≤50 rows → table like the wizard; > → per-row pages), media downloaded within the 1-hour URL window (403 → re-fetch block), incremental search sorted by `last_edited_time` with 2-min overlap (minute rounding), trash-sweep for deletions, self-imposed 3 rps token bucket. Onboarding interstitial: "tick your top-level pages — everything inside comes along" (the Anytype lesson).
- **Dropbox** (dark): offline OAuth (`token_access_type=offline`, scopes `files.metadata.read files.content.read account_info.read`), OWN folder picker (non-recursive list_folder tree), initial recursive list_folder→cursor, downloads 6-way bounded honoring Retry-After (a 429 may be lock contention — same remedy), `content_hash` skip, md/txt/html files → mddoc/html path, images/attachments → media, webhook receiver endpoint (HMAC `X-Dropbox-Signature`, 10s ack, enqueue account_id) + hourly fallback poll, 409 `reset` → re-list + reconcile.

## 8. API & UI

Router `api/routers/note_sync.py` (`/api/j2/notes/connectors`): `GET /status` (providers configured/connected, per-source freshness) · `POST /{provider}/connect` (token payload or `{}` to start OAuth → `{redirect_url}`) · `GET /{provider}/callback` (OAuth) · `POST /sources/{id}/sync` (manual, `background=1` supported) · `PUT /sources/{id}` (sync_enabled, dest folder) · `DELETE /{provider}` (disconnect: revoke best-effort, purge tokens, KEEP notes, sever source links) · `GET /sources/{id}/log`. Paid-plan gate mirrors broker connect; consent checkbox required.
UI: `ConnectedAppsCard` (Settings + a compact variant inside the wizard's drop step): provider tiles (Connect / Connected · n sources / "Not available yet" for dark providers with no env creds), paste-token modal for roam/craft with provider-specific field help, OAuth redirect handling via return-querystring (the broker card's load-bearing pattern), per-source rows (freshness tone, counts, Sync now, pause, disconnect). `SyncTrustCenter`-style strip on the Notebook tab when any source exists (incl. conflict count).

## 9. Testing

Unit: converter tables (fixture-per-block-type), provider clients against recorded fixtures (no live calls), engine upsert/conflict/delete-detection/cursor-overlap, crypto roundtrip, migration v3 via `ensure_schema` on a v2-shaped DB (the lesson). Contract rails: the vitest schema-validation over Python-emitted fixtures; hash parity Python↔JS. Router: TestClient suite incl. OAuth callback (mocked provider), paid gate, consent. Live gates before ship: real Roam graph + real Craft space end-to-end on the sandbox (owner tokens, or mine if provided); Notion/Dropbox live-gated at activation time. On-screen Playwright pass of the connect → first-sync → note-renders flow with a mock provider.

## 10. Deferred waves (documented gates)

OneNote (durable resumable queue vs 400 req/hr, no delta; Azure app + publisher verification) · OneDrive (delta API, same Graph app) · Google Drive (CASA ~$3–5K/yr — owner budget call) · Obsidian community plugin (separate TS artifact; POSTs vault via a per-user connect code to a new ingest endpoint; disclosure per Obsidian dev policy; ~24h automated listing) · Apple Notes Mac helper (NoteStore.sqlite reader + launchd, separate signed artifact) + Shortcuts one-shot guide · Keep scheduled-Takeout auto-ingest (rides Drive or Dropbox connector) · Notion webhooooks receiver activation · merge-grade conflict UX.

## 11. Rollout

Branch `note-connectors`. Everything behind `NOTE_SYNC_ENABLED` (default off) + per-provider env creds; Roam/Craft usable the moment the flag flips (no vendor registration). Migration v3 additive. Owner activation checklist ships in the final report: flip flag → paste nothing (Roam/Craft just work) → register Notion integration + Dropbox app when ready → set env → providers light up without deploys.
