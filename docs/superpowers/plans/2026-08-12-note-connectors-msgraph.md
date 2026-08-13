# Note Connectors — Microsoft Graph wave (OneNote + OneDrive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two read-only background-sync providers — OneDrive (Graph delta) and OneNote (Graph pages, HTML, no delta → durable resumable queue) — to the shipped connector framework, through the existing `import_confirm` pipeline and the cross-language schema rail, DARK behind `NOTE_SYNC_ENABLED` + one shared Microsoft Graph OAuth app.

**Architecture:** Two `NoteProvider` implementations (`providers/onedrive.py`, `providers/onenote.py`) over a shared `providers/msgraph_base.py`, one shared Microsoft Graph entry in `oauth.py::_PROVIDERS` reused by both, one OneNote converter (`convert/onenote_html.py` + a `taskList` branch in `html_to_tiptap`), ONE optional engine hook (`list_present_refs`), two registry rows, two `ConnectedAppsCard` tiles. No new endpoints, no migration, no new deps.

**Tech Stack:** FastAPI + SQLite (WAL), httpx (async), markdown-it-py + `html.parser`, crypto_box `NoteBox` (existing key family), APScheduler (unchanged); React + SWR; vitest + pytest.

**Spec:** `docs/superpowers/specs/2026-08-12-note-connectors-msgraph-design.md` — READ IT FIRST for any task; it carries the Microsoft Graph mechanics + citations. Wave-1 spec `2026-08-11-note-connectors-design.md` + plan `2026-08-11-note-connectors.md` are the framework this extends.

## Global Constraints

- Worktree `C:\Users\Patrick\uct-worktrees\note-connectors`, branch `note-connectors`. Explicit `git add <paths>` only — NEVER `git add -A`. Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Backend tests from worktree root: `python -m pytest <file> -v`. Frontend from `app/`: `cd app && npx vitest run <path>` (never `--prefix`/`--root`). The repo-root conftest sandboxes `/data` — never bypass.
- **Reuse, don't reinvent.** Both providers implement `providers/base.py::NoteProvider` (validate/list_changed/fetch/fetch_many/fetch_media, RemoteRef/RemoteNote, opaque_cursor, import_key) and raise ONLY the `errors` taxonomy (`NoteConnNotConfigured/NoteConnAuthError/NoteConnTokenExpired/NoteConnRateLimited(retry_after)/NoteConnTransient/NoteConnUnsupported(reason)`). Never leak a raw httpx/Graph error.
- **Credential boundary (named critical class):** the Graph bearer attaches to `graph.microsoft.com` ONLY. OneDrive's 302 download URL and any external image are fetched with NO `Authorization` header (external content via SSRF-guarded `guarded_media_get`/`assert_public_https`). Never log a token, code, or secret.
- **Import-inert:** importing any new module with no env set never raises; `configured()` false until `MSGRAPH_CLIENT_ID`/`SECRET` exist; env read live in function bodies, never at import.
- **Ordering (from the wizard):** import hash over the PLACEHOLDER body BEFORE upload/rewrite; remote `lastModifiedDateTime` → confirm payload `updatedAt` (the change signal, and OneNote's watermark).
- **Second-authority rail:** every converter change regenerates the golden fixtures consumed by the vitest schema-contract test (wave-1 Task 5). A converter task is not done until its fixtures validate in vitest.
- **Cursor discipline:** the engine stores `provider.opaque_cursor` verbatim — the provider is the ONLY authority on the OneNote watermark-JSON shape; the engine never parses it.
- **No migration, no new deps** (spec §11, §15) — so no `requirements.txt` change and **no `UCT_FLOW_OVERRIDE`** review. Confirm in the final report.
- **Scheduler unchanged** (:23 hourly tick, 01:47 ET nightly full, `NOTE_SYNC_ENABLED` double-gate). Delete detection reaches OneNote only via the nightly full pass.
- UI: UIcon only (no emoji); breakpoints 640/1024; Sheet idiom; paid gate + consent checkbox mirror `ConnectedAppsCard`.

## File Structure

```
api/services/journal_two/note_connectors/
  oauth.py                                  # + onenote/onedrive _PROVIDERS entries; form-encoded token support
  registry.py                               # + onenote/onedrive ProviderEntry rows
  engine.py                                 # + optional list_present_refs hook (full-pass only)
  providers/msgraph_base.py                 # NEW — shared Graph client (bearer, 429/backoff, /me)
  providers/onedrive.py                     # NEW — OneDriveProvider (delta, opaque cursor)
  providers/onenote.py                      # NEW — OneNoteProvider (resumable watermark queue)
  convert/onenote_html.py                   # NEW — OneNote HTML pre-pass
  convert/mddoc.py                          # + html_to_tiptap taskList branch (data-uct-task marker)
  convert/__init__.py                       # + onenote_html_to_tiptap export
api/routers/note_sync.py                    # generalize _start_oauth/oauth_callback + folders to onedrive
api/services/journal_two/note_connectors/test_note_connectors_msgraph_oauth.py
api/services/journal_two/note_connectors/test_note_connectors_onedrive.py
api/services/journal_two/note_connectors/test_note_connectors_onenote.py
api/services/journal_two/note_connectors/test_note_convert_onenote.py
api/services/journal_two/note_connectors/test_note_connectors_engine_present_refs.py
tests/test_note_sync_router.py              # extend: onenote/onedrive OAuth + folders
app/src/pages/journal-2-0/components/connectors/ConnectedAppsCard.{jsx,test.jsx}   # + 2 tiles
app/src/pages/journal-2-0/lib/importer/__fixtures__/server_convert/*.json          # regenerated
```

---

### Task 1: Shared Microsoft Graph OAuth wiring

**Files:** Modify `note_connectors/oauth.py`; modify `api/routers/note_sync.py` (`_start_oauth`, `oauth_callback` generalization); test `test_note_connectors_msgraph_oauth.py` (new) + extend `tests/test_note_sync_router.py`.
**Interfaces:** Generalize `_OAuthProviderConfig` with `token_request_style: "json"|"form"` (default `"json"`) and `credentials_in: "basic"|"body"` (default `"basic"`); `_post_token` branches on them (Microsoft = form + client_id/secret in body, `Content-Type: application/x-www-form-urlencoded`). Add TWO `_PROVIDERS` entries — `onenote` and `onedrive` — BOTH reading `MSGRAPH_CLIENT_ID`/`MSGRAPH_CLIENT_SECRET`, `authorize_url=https://login.microsoftonline.com/common/oauth2/v2.0/authorize`, `token_url=.../token`, `extra_authorize_params={"scope": "openid offline_access User.Read Notes.Read"}` (onenote) / `{"scope": "openid offline_access User.Read Files.Read"}` (onedrive), `response_mode=query`. `_normalize_token_response` UNCHANGED (already generic; Microsoft has no workspace fields to add). Refresh rotation is already handled by `refresh_if_needed` (Microsoft rotates like Notion — spec §5). Router: `_start_oauth`/`oauth_callback` branch on `provider in oauth._PROVIDERS` (generic Notion path) instead of `provider == "notion"`, so onenote/onedrive route through `oauth.authorize_url`/`oauth.exchange_code` with zero per-name code; the Dropbox-owned path stays the `else`.
- [ ] Failing tests: form-encoded token POST carries client_id/secret in the BODY (assert request content-type + body, MockTransport); `configured("onenote")`/`configured("onedrive")` both true iff `MSGRAPH_CLIENT_ID`+`MSGRAPH_CLIENT_SECRET` set, false with neither; `authorize_url("onenote", state)` contains the common authorize endpoint + the onenote scope + the derived `/onenote/callback` redirect; refresh rotation persists the NEW refresh_token (reuses the existing lock-dedupe test shape); **control:** Notion's JSON+Basic token POST still works unchanged (assert its content-type is still JSON). Router: `POST /onenote/connect` with consent returns a `redirectUrl` to login.microsoftonline.com; `oauth_callback` for onenote calls `oauth.exchange_code` (mock) and upserts; Notion connect/callback regression stays green.
- [ ] Implement; run `python -m pytest api/services/journal_two/note_connectors/test_note_connectors_msgraph_oauth.py api/services/journal_two/note_connectors/test_note_connectors_oauth*.py tests/test_note_sync_router.py -v` (existing OAuth + router suites must stay green).
- [ ] Commit `feat(connectors): shared Microsoft Graph OAuth wiring (form-encoded token, onenote+onedrive entries)`.

### Task 2: Microsoft Graph base client + OneDrive provider (delta)

**Files:** Create `providers/msgraph_base.py`, `providers/onedrive.py`; test `test_note_connectors_onedrive.py`.
**Interfaces:** `msgraph_base.py`: `MSGraphClient` — one httpx.AsyncClient, `Authorization: Bearer` attached ONLY to `graph.microsoft.com`, `_send(method, path, ...)` with 429 handling (honor `Retry-After` if present else jittered exponential backoff, bounded retries), `GET /me` for `validate` → `AccountInfo(label=displayName or userPrincipalName)`. Tests inject a `client` on `httpx.MockTransport` + a `sleep_fn`. `OneDriveProvider(NoteProvider, folder_path=...)` per spec §7: `name="onedrive"`; `list_changed(creds, cursor)` — `GET /me/drive/items/{folderId}/delta` (or continue from a stored `deltaLink`/`nextLink`), drain `@odata.nextLink` up to `MSGRAPH_ONEDRIVE_PAGES_PER_TICK`, publish `self.opaque_cursor` = final `@odata.deltaLink` (or interim `nextLink` if budget hit); a `410 Gone` → restart from folder root + reconcile (Dropbox `reset` shape). Deleted items (`"deleted": {}` facet) collected → exposed via `list_deleted(creds)` (engine full-pass channel). Note-extension items (`.md/.html/.htm/.txt`) → `RemoteRef(remote_id=itemId, updated_at=lastModifiedDateTime)`; folders + non-note files skipped as note candidates. `fetch` → `GET /me/drive/items/{id}/content`, follow the 302 to the pre-authenticated URL with NO auth header → route by extension (`.md`→`md_to_tiptap`, `.html`→`html_to_tiptap`, `.txt`→`_txt_to_tiptap`; `.docx`→named `NoteConnUnsupported`). Relative media/attachments resolve against the delta-enumerated item index (Dropbox approach). `list_folders(creds, path)` → `GET .../children` filtered to folder-faceted items. `import_key` = base default `onedrive:{folderId}/{itemId}`.
- [ ] Failing tests (MockTransport fixtures): delta drain nextLink→deltaLink publishes the deltaLink as opaque_cursor; second call continues from deltaLink; `deleted` facet → `list_deleted` returns it; 410 → full re-list from root; folder scoping hits `/items/{folderId}/delta`; download follows 302 to an unauthenticated URL (assert NO Authorization on the download hop); extension routing (md/html/txt → correct doc, docx → NoteConnUnsupported); 429 with and without Retry-After both back off then succeed; bad token → NoteConnAuthError.
- [ ] Implement; `python -m pytest api/services/journal_two/note_connectors/test_note_connectors_onedrive.py -v`; regenerate + validate rail fixtures for onedrive samples (wave-1 Task 5 harness).
- [ ] Commit `feat(connectors): Microsoft Graph base client + OneDrive delta provider (dark)`.

### Task 3: OneDrive registry entry + folder-picker + connect flow

**Files:** Modify `registry.py` (add `onedrive` entry); modify `api/routers/note_sync.py` (`GET /{provider}/folders` allow `onedrive`); extend `tests/test_note_sync_router.py`.
**Interfaces:** `registry.py` — `ProviderEntry("onedrive", "OneDrive", "oauth", lambda: oauth.configured("onedrive"), _build_onedrive)` where `_build_onedrive(source)` reads `source["remoteId"]` as `folder_path=` (Dropbox `_build_dropbox` shape — one connector backs multiple folder sources). Router — `list_provider_folders` accepts `onedrive` alongside `dropbox` (both dispatch `provider_obj.list_folders`); the OAuth callback (generalized in Task 1) creates the connector but NOT an auto-source (Dropbox pattern); folder pick → existing `POST /{provider}/sources` creates the folder-scoped source.
- [ ] Failing tests: `GET /status` shows `onedrive` configured/unconfigured matrix; `GET /onedrive/folders` (mock provider) returns folders, `GET /notion/folders` still 404; connect onedrive → redirectUrl (no auto-source); `POST /onedrive/sources` with a folder remoteId creates a source; paid gate 403 + consent-required 400 hold.
- [ ] Implement; `python -m pytest tests/test_note_sync_router.py -v` (full router suite green).
- [ ] Commit `feat(connectors): OneDrive registry entry + folder picker`.

### Task 4: Engine `list_present_refs` hook (delete detection across a bounded drain)

**Files:** Modify `engine.py`; test `test_note_connectors_engine_present_refs.py` (fake provider).
**Interfaces:** In `_do_sync`, on a `full` pass ONLY, `present_fn = getattr(provider, "list_present_refs", None)`; if present, `present_refs = await present_fn(creds)` and use `present_refs` for `_touch_remote_index(...)` and as the `seen_ids` source for `_run_delete_detection(...)`, while `list_changed`'s (possibly bounded) `refs` still drive `_fetch_remote_notes`. A failing `list_present_refs` (transient/rate limit) is caught → falls back to today's behavior (refs drive everything) with a named `item_failures` entry, never aborts. On incremental passes and for providers without the hook, behavior is byte-for-byte unchanged (Roam/Craft/Notion/Dropbox/OneDrive define no such method). Mirror the EXACT `getattr(provider, "list_deleted", None)` seam already in `_do_sync`.
- [ ] Failing tests (fake provider exposing `list_present_refs` returning a COMPLETE set while `list_changed` returns a BOUNDED subset): on a full pass, delete detection runs over the complete set (an absent-2-nights id severs; a present-but-unfetched id is touched, miss_streak reset, NOT severed); fetch is called only for the bounded `list_changed` refs; a raising `list_present_refs` falls back to refs-drive-everything + logs a failure; **mutation check:** delete the hook → the fake OneNote full pass with a bounded `list_changed` trips the <50% refuse guard (delete detection blind) — proving the hook is load-bearing; **control:** a fake provider WITHOUT the method is unaffected (existing engine tests stay green).
- [ ] Implement; `python -m pytest api/services/journal_two/note_connectors/test_note_connectors_engine*.py -v` (full engine suite green — the whole wave-1 engine behavior must not move).
- [ ] Commit `feat(connectors): engine list_present_refs hook for cheap-enumerate/expensive-fetch providers`.

### Task 5: OneNote converter — `onenote_html.py` + `html_to_tiptap` task-list branch

**Files:** Create `convert/onenote_html.py`; modify `convert/mddoc.py` (`html_to_tiptap` taskList branch) + `convert/__init__.py` (export); test `test_note_convert_onenote.py`.
**Interfaces:** `mddoc.py` — `html_to_tiptap`'s block walker recognizes `<li data-uct-task="0|1">` and groups consecutive such `<li>`s into a `taskList` of `taskItem(checked=bool)` (mirroring the markdown checkbox path's run-grouping; TODAY it drops `<input type=checkbox>`, mddoc.py ~L665 — this is the ONE additive branch). Inert for any other caller (Dropbox `.html` never emits the marker). `onenote_html.py` — `onenote_html_to_tiptap(html) -> {doc, media, links}`: a pre-pass then `html_to_tiptap`. Pre-pass: `data-tag="to-do"`/`"to-do:completed"` on `<p>`/`<li>` → `<ul><li data-uct-task="0|1">…</li></ul>`; resource `<img src data-fullres-src>` → `<img src="{REF_PREFIX}onenote-res://{resourceId}">` + media entry (prefer fullres); `<object data-attachment data>` → `<a href="{ATTACHMENT_REF_PREFIX}onenote-res://{resourceId}">name</a>`; strip `position:absolute` wrapper divs (unwrap); external `http(s)` `<img>` left as-is (resolved later, unauthenticated). Export from `convert/__init__.py`.
- [ ] Failing tests: to-do paragraph (checked + unchecked) → `taskList`/`taskItem(checked)`; resource `<img>` → image node with `import-ref://onenote-res://{id}` + a media entry; `<object>` attachment → `attachmentChip`; absolute-div unwrapped to its children; external `<img src="https://…">` stays a plain image ref (no `onenote-res://` prefix); a plain OneNote page (headings/lists/table/links) → correct TipTap. Then fixtures through the schema rail (`Node.fromJSON` + `generateHTML`), incl. a taskList fixture. **Mutation check:** corrupt the taskItem `checked` attr → vitest reds.
- [ ] Implement; `python -m pytest api/services/journal_two/note_connectors/test_note_convert_onenote.py -v`; regenerate fixtures via `python -m ...convert.fixtures_gen` → `cd app && npx vitest run src/pages/journal-2-0/lib/importer/serverConvert.contract.test.js` green.
- [ ] Commit `feat(connectors): OneNote HTML converter + html_to_tiptap task-list branch`.

### Task 6: OneNote provider — resumable watermark queue

**Files:** Create `providers/onenote.py`; test `test_note_connectors_onenote.py`.
**Interfaces:** `OneNoteProvider(NoteProvider)` over `MSGraphClient`, `name="onenote"`, per spec §5/§6/§9/§10. `import_key` overridden → flat `onenote:{page_id}` (Notion precedent). `validate` → `GET /me`. Enumeration: `GET /me/onenote/notebooks?$expand=sections,sectionGroups($expand=sections)` → section ids, then PER SECTION `GET /me/onenote/sections/{id}/pages?$select=id,title,lastModifiedDateTime&$top=100` with `$skip` paging (⚠️ `$top` suppresses `@odata.nextLink` — page via `$skip`). `list_changed(creds, cursor)`: parse the opaque JSON watermark (`{"v":1,"watermark","at_watermark_ids"}`; cursor `None`/unparseable → epoch watermark); collect pages with `lastModifiedDateTime >= watermark` excluding `at_watermark_ids`; sort ascending; return the first `MSGRAPH_ONENOTE_PAGES_PER_TICK` (default 40) as RemoteRefs; publish `self.opaque_cursor` = new watermark JSON (K-th page's timestamp + ids at that timestamp). `list_present_refs(creds)`: the COMPLETE present page-id set (ids+timestamps only, cheap) — feeds the Task-4 engine hook. `fetch`: `GET /me/onenote/pages/{id}/content?includeIDs=true` (HTML) → `onenote_html_to_tiptap` → RemoteNote (`folder_path` from section/notebook names). `fetch_media`: `onenote-res://{id}` → **authenticated** `GET /me/onenote/resources/{id}/$value` (Bearer to graph.microsoft.com only); external `https` → `guarded_media_get` (no auth). Per-tick admission control: a request counter with ceiling `MSGRAPH_ONENOTE_MAX_REQUESTS_PER_TICK` (default 120) → stop, publish cursor at last fully-enumerated point, return; `AsyncRateLimiter` low rps. 429: honor `Retry-After` if present else jittered backoff (Retry-After NOT guaranteed — spec §5/§10); retry only on 429.
- [ ] Failing tests (MockTransport): per-section enumeration with `$skip` paging (assert NO reliance on nextLink under `$top`); watermark drain returns ≤K ascending, advances cursor to the K-th + `at_watermark_ids`; next call resumes past the watermark, excludes at-watermark ids (no skip, no re-loop at the boundary); `list_present_refs` returns the COMPLETE set regardless of K; resource media authenticated (assert Bearer on `/resources/{id}/$value`) vs external unauthenticated (assert NO Bearer); 429 without Retry-After backs off; per-tick request-budget bail leaves a resumable cursor; encrypted/inaccessible page → named per-item failure not a crash; bad token → NoteConnAuthError.
- [ ] Implement; `python -m pytest api/services/journal_two/note_connectors/test_note_connectors_onenote.py -v`; regenerate + validate rail fixtures for onenote page samples.
- [ ] Commit `feat(connectors): OneNote resumable-queue provider (dark)`.

### Task 7: OneNote registry entry + ConnectedAppsCard tiles

**Files:** Modify `registry.py` (add `onenote`); modify `app/src/pages/journal-2-0/components/connectors/ConnectedAppsCard.jsx` (+ its test); extend `tests/test_note_sync_router.py` for onenote status.
**Interfaces:** `registry.py` — `ProviderEntry("onenote", "OneNote", "oauth", lambda: oauth.configured("onenote"), _build_onenote)` (`_build_onenote` ignores `source`, like Notion). OneNote callback auto-creates ONE whole-account source (Notion pattern — the generalized `oauth_callback` already handles this: onenote gets a `remote_id` from `creds`/`/me` and a default `"OneNote — {name}"` folder). UI — two new provider tiles (`onenote`, `onedrive`) in `ConnectedAppsCard`, both `connect_kind="oauth"` → the Notion/Dropbox OAuth-redirect + `?connector=…&connected=1` self-heal path verbatim; "Not available yet" when `configured` false; OneDrive reuses the Dropbox folder-picker UI; OneNote shows a single whole-account `SourceRow`. UIcon glyphs (add `onenote`/`onedrive`/`microsoft` if absent — no emoji). No new hook (`useNoteConnectors` already renders `registry.names()`).
- [ ] Failing tests: `GET /status` includes `onenote` + `onedrive` in the providers matrix (order stable); `ConnectedAppsCard.test.jsx` renders both tiles from mocked status, "Not available yet" when unconfigured, "Connect" fires the OAuth redirect when configured, OneDrive folder-pick path renders.
- [ ] Implement; `cd app && npx vitest run src/pages/journal-2-0` (watch the FILE count) + `python -m pytest tests/test_note_sync_router.py -v`.
- [ ] Commit `feat(connectors): OneNote/OneDrive registry entries + Connected apps tiles`.

### Task 8: Full verification + docs + activation checklist

**Files:** CLAUDE.md one-liner (Journal 2.0 connectors line — add OneNote/OneDrive); no new code except gate scripts (uncommitted).
- [ ] Backend: `python -m pytest api/services/journal_two/ tests/test_note_sync_router.py -q` — all green (report any pre-existing master-red only if still red on master).
- [ ] Frontend: full `src/pages/journal-2-0` sweep + `npm run build` — connectors code must NOT grow the main index chunk (grep dist).
- [ ] Contract rail: regenerate fixtures → vitest contract test green → `git status` proves no fixture drift.
- [ ] Confirm **no `requirements.txt` change** (`git diff --name-only origin/master..HEAD | grep -c requirements` = 0) → no `UCT_FLOW_OVERRIDE` needed; state this in the final report.
- [ ] LIVE GATE (activation-time, personal Microsoft account on the sandbox uvicorn): connect onenote + onedrive end-to-end → initial PACED drain (assert the watermark advances across successive manual "Sync now" calls, notes/folders/media/links land, `.docx` shows the named unsupported message) → re-sync all-skipped → nightly full pass delete detection (`list_present_refs` complete, an absent page severs after two full passes) + an on-screen Playwright connect→first-sync→renders pass with a mock Graph server.
- [ ] Commit docs; push branch (owner runs `git push` — classifier-blocked in both shells). Do NOT ship to master beyond the branch; final report includes the §14 activation checklist (Azure app + publisher verification + admin-consent fallback) and the feasibility verdict.

## Execution notes for the controller
- Sequence: 1 → 2 → 3 (OneDrive lands first: simpler, delta) → 4 (engine hook, needed before OneNote's delete detection) → 5 → 6 (OneNote) → 7 → 8. Tasks 2 and 5 are file-disjoint and can overlap after 1. Task 6 needs 4 + 5. Task 7 needs 3 + 6. Task 8 last.
- Implementer model: **sonnet** for 1 (shared OAuth + router generalization — must not break Notion/Dropbox), 2 (delta semantics + 302/410 edges), 4 (engine change — careful, mutation-checked), 5 (converter judgment), 6 (the resumable-queue provider — the hard one). **haiku** acceptable with full briefs for 3 (registry + folder-picker transcription) and 7 (tiles transcription); registry rows in 3/7 are trivial. Reviewers sonnet; final review most-capable.
- The ONE engine change (Task 4) is the only edit to shipped wave-1 behavior — it is getattr-gated and mutation-checked so the four shipped providers are provably unaffected.
