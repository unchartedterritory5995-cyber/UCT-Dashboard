# Note Connectors — Microsoft Graph wave (OneNote + OneDrive)

**Date:** 2026-08-12
**Status:** Design complete (research-driven, 2026 Microsoft Learn citations inline), implementation planned
**Scope:** Two new read-only background-sync providers — **OneNote** (Graph pages → HTML) and **OneDrive** (Graph drive → files) — layered on the connector framework shipped 2026-08-12 (spec `2026-08-11-note-connectors-design.md`). This wave adds NO new architecture: it is one shared Microsoft Graph OAuth registration reused by two `NoteProvider` implementations, one small optional engine hook, and two converter touches. Everything stays DARK behind `NOTE_SYNC_ENABLED` + the Microsoft Graph app credentials.

> **Read `docs/superpowers/specs/2026-08-11-note-connectors-design.md` FIRST.** This document is a delta on it. §3 (architecture), §4 (conversion layer + the schema rail), §5 (schema), §6 (conflict policy), §7 (provider mechanics), §8 (endpoints/UI) are reused wholesale unless contradicted here. The deferred-wave note in that spec's §10 ("OneNote — durable resumable queue vs 400 req/hr, no delta; Azure app + publisher verification · OneDrive — delta API, same Graph app") is what this document discharges.

---

## 1. Motivation & relationship to wave 1

Wave 1 shipped four providers on one contract (`providers/base.py::NoteProvider`) and one engine (`note_connectors/engine.py`): Roam + Craft live (pasted tokens), Notion + Dropbox dark (OAuth). The two shapes it established map exactly onto the two Microsoft surfaces:

- **OneNote resembles Notion** — page enumeration, **HTML** page content, **no delta/change feed** → poll `lastModifiedDateTime`, converter emits TipTap.
- **OneDrive resembles Dropbox** — a folder of files, plus a **real delta API with a durable opaque cursor** → the engine's existing `opaque_cursor` mode carries it verbatim.

So this wave is almost entirely *reuse*. The single genuinely new engineering problem is OneNote's combination of **(a) no delta feed** and **(b) undocumented, aggressive per-app-per-user throttling**, which together mean a large notebook cannot be pulled in one sync tick. That is §6 below and is the reason this wave was deferred out of wave 1.

---

## 2. Feasibility verdict — CAN MEMBERS SELF-CONNECT?

**The key question, resolved precisely (it is nuanced, and two of the wave-1 planning assumptions were wrong):**

**Verdict:** With the **delegated** read-only scopes `Notes.Read`, `Files.Read`, `offline_access`, `User.Read` — every one of which carries **AdminConsentRequired = No** in the Microsoft Graph permissions reference [1][2][3][4] — a member connecting a **personal** Microsoft account (`consumers`) can **always self-consent** with no admin involvement (personal accounts are not subject to any tenant policy). A member connecting a **work/school** account *can* self-consent by the permission definition, **but** a tenant's user-consent policy plus "risk-based step-up consent" (in force for multi-tenant apps registered after 2020-11-08 requesting anything beyond basic sign-in) can route them to **admin approval** instead — so **publisher verification of our Azure app is effectively required, and an admin-consent / "request approval" fallback must be first-class** for reliable work-school onboarding.

Why the nuance matters (do not bake the wrong version into the build):

- **"Admin consent = No" ≠ "every user can self-consent."** The tenant Privileged Admin chooses a user-consent policy [5][6]. Microsoft's newer default trends toward *"users can consent only to apps from verified publishers, only for low-impact permissions."* `Files.Read`/`Notes.Read` are **not** in the low-impact set (only `openid`/`profile`/`email`/`offline_access` are, unless an admin classifies more [7]). Under that increasingly-common default, a work/school user hitting our app with `Files.Read`+`Notes.Read` is **routed to admin consent** even though the permissions themselves say admin-consent = No.
- **The `.All` assumption from wave-1 planning is half-wrong.** For **delegated** permissions, `Files.Read.All` is *also* AdminConsentRequired = **No** [3]; the admin-consent boundary is **delegated vs application**, not `.All`. We request only the non-`.All` delegated scopes anyway, so this never bites us — but the spec must not repeat the myth.
- **Risk-based step-up consent** [8]: *"Beginning November 2020, if risk-based step-up consent is enabled, users can't consent to most newly registered multitenant apps that aren't publisher verified … which request permissions that extend beyond the basic sign-in and read user profile."* Our app is exactly that. **Publisher verification** (free; associate a verified Microsoft AI Cloud Partner Program / Partner One ID + a non-`*.onmicrosoft.com` publisher domain) [8] removes the "unverified/risky" warning and is a practical prerequisite for the work/school self-connect path.

**One-sentence answer:** *members can self-connect with the delegated scopes `Notes.Read`/`Files.Read`/`offline_access`/`User.Read` (all AdminConsentRequired = No [1][2][3][4]) — unconditionally for personal Microsoft accounts, and for work/school accounts wherever the tenant's user-consent policy permits, which in practice requires our Azure app to be publisher-verified and an admin-consent fallback to exist* [8].

**Buildability impact:** none blocks the build. The connector is buildable and testable end-to-end against a personal Microsoft account with zero admin. Publisher verification and the admin-consent fallback are **activation-time** owner tasks (§14), not code prerequisites; the code path is identical whether consent was granted by the user or by an admin.

---

## 3. Goals & non-goals

**Goals**
- Two new registry providers — `onenote`, `onedrive` — each a `NoteProvider` implementing `validate`/`list_changed`/`fetch`/`fetch_many`/`fetch_media`, raising ONLY the shared `errors` taxonomy, import-inert with no env set.
- ONE Microsoft Graph OAuth app (`MSGRAPH_CLIENT_ID`/`MSGRAPH_CLIENT_SECRET`) registered in `oauth.py::_PROVIDERS`, consumed by BOTH providers (they differ only in requested scope). Reuses wave-1's lock-guarded, rotation-safe `refresh_if_needed` unchanged (Microsoft Graph rotates refresh tokens exactly like Notion [9]).
- OneNote: a **durable, resumable, budget-bounded** content drain that respects Microsoft's (undocumented, defensive) per-app-per-user throttling, persists progress across ticks, never re-pulls from scratch, and never exceeds a self-imposed per-tick request budget.
- OneDrive: ride the existing `opaque_cursor` mode on the Graph **delta** API (`deltaLink`/`nextLink`), with folder scoping and a folder picker mirroring Dropbox.
- Conversion: OneNote HTML → `html_to_tiptap` (via a small OneNote pre-pass); OneDrive files → existing `md_to_tiptap`/`html_to_tiptap`/`_txt_to_tiptap`. The cross-language schema rail (wave-1 §4) covers the new fixtures.
- Everything DARK behind `NOTE_SYNC_ENABLED` (scheduler) + per-provider `configured()` (the Microsoft Graph app creds). Zero new endpoints; two small one-time generalizations of existing router handlers.

**Non-goals (this wave)**
- Writing back to OneNote/OneDrive (one-way, source → Notebook — same as wave 1).
- Per-notebook OneNote source selection (v1 syncs the whole account's notebooks as ONE source; per-notebook picker is future work).
- `.docx` server-side conversion (the file-importer wizard handles docx client-side; the server converters are md/html/txt only — OneDrive `.docx` files are a documented GAP, §8).
- OneDrive **whole-drive** default sync (v1 requires a folder pick, mirroring Dropbox — a whole-drive source would enumerate every non-note file the user owns).
- Google Drive, Obsidian plugin, Apple helper (still deferred, wave-1 §10).
- PKCE (v1 is a confidential web client with a secret; Microsoft permits confidential-client auth-code WITHOUT PKCE [9]. PKCE is a future hardening — it needs the per-flow `code_verifier` persisted against our signed state, which the current stateless state flow does not carry).

---

## 4. Architecture — what is reused, what is added

```
Settings / Wizard "Connected apps" card
  └─ Connect (OAuth): onenote | onedrive   ── NEW tiles, dark until MSGRAPH_CLIENT_ID/SECRET set
       └─ POST /api/j2/notes/connectors/{provider}/connect  → oauth.authorize_url(provider, signed_state)  [generic path, ALREADY used by notion]
       └─ GET  /api/j2/notes/connectors/{provider}/callback → oauth.exchange_code(provider, code)          [generic path]
Background: APScheduler (NOTE_SYNC_ENABLED) — UNCHANGED (:23 hourly tick + 01:47 ET nightly full)
  └─ engine.sync_due_sources / sync_all_active_sources_full → registry.build_provider(name, source)
       └─ OneNoteProvider / OneDriveProvider  (NEW, providers/base.py contract, ZERO engine coupling changes except one optional hook)
```

**New files (all mirror an existing wave-1 file):**

| New module | Mirrors | Role |
|---|---|---|
| `providers/msgraph_base.py` | (new shared base; the "credential-boundary + transport" half of `notion.py`/`dropbox.py`) | `MSGraphClient` — bearer via `oauth.refresh_if_needed`, `graph.microsoft.com` is the ONLY host it attaches the token to, 429 handling with `Retry-After`-if-present-else-jittered-backoff, `GET /me` for `validate`. Both providers use it. |
| `providers/onedrive.py` | `providers/dropbox.py` | `OneDriveProvider` — delta cursor (opaque), folder scoping + picker, item download, `deleted` facet → `list_deleted`. |
| `providers/onenote.py` | `providers/notion.py` | `OneNoteProvider` — per-section page enumeration, HTML content, resumable watermark cursor (opaque), bounded content drain, resource media, `list_present_refs`. |
| `convert/onenote_html.py` | `convert/roam_text.py` (a pre-pass), `convert/notion_blocks.py` (provider-specific converter) | OneNote HTML normalization before `html_to_tiptap`. |

**Modified files (all additive):**

| Modified | Change |
|---|---|
| `note_connectors/oauth.py` | Add `onenote` + `onedrive` to `_PROVIDERS` (shared `MSGRAPH_CLIENT_ID`/`MSGRAPH_CLIENT_SECRET`, different `scope`). Generalize `_OAuthProviderConfig`/`_post_token` to support **form-encoded** token bodies + **client-secret-in-body** (Microsoft's token endpoint is `application/x-www-form-urlencoded`, not JSON+Basic like Notion [9]). `_normalize_token_response` needs NO change — it already extracts `accessToken`/`refreshToken`/`expiresAt` generically and only *adds* Notion workspace fields when present. |
| `note_connectors/registry.py` | Add `onenote` + `onedrive` `ProviderEntry` rows (`connect_kind="oauth"`, `configured` = `oauth.configured(name)`, `build` = lazy import). |
| `note_connectors/engine.py` | **One** optional hook (§9): on a **full** pass, if `getattr(provider, "list_present_refs", None)` exists, use its (cheap, complete) result for `_touch_remote_index` + `_run_delete_detection`'s `seen_ids`, while `list_changed`'s (bounded) refs still drive `fetch`. Mirrors the existing `getattr(provider, "list_deleted", None)` seam EXACTLY. Roam/Craft/Notion/Dropbox don't define it → today's behavior byte-for-byte. |
| `convert/mddoc.py` | Additive: `html_to_tiptap`'s block walker learns to render ONE task-list marker (`data-uct-task="0|1"` on `<li>`) as `taskList`/`taskItem` — it currently drops `<input type=checkbox>` (see its own vocabulary note, mddoc.py ~L665). The OneNote pre-pass emits that marker; no other caller does, so this is inert for Dropbox `.html`. |
| `convert/__init__.py` | Export `onenote_html_to_tiptap` (the pre-pass + `html_to_tiptap` composition). |
| `api/routers/note_sync.py` | Two ONE-TIME generalizations, no new routes: (a) `_start_oauth`/`oauth_callback` branch on **`provider in oauth._PROVIDERS`** (the generic Notion path) instead of `provider == "notion"`, so any generic-OAuth provider is handled; (b) `GET /{provider}/folders` allows `onedrive` in addition to `dropbox` (both dispatch to the provider's own `list_folders`). |

**No new database table, and no migration.** OneDrive's cursor is an opaque `deltaLink` (fits `j2_note_sources.cursor`). OneNote's progress is a JSON watermark **also** stored in `j2_note_sources.cursor` (opaque-cursor mode, §6). Delete detection uses the existing `j2_note_remote_index`. See §11.

---

## 5. Microsoft Graph API surface (verified 2026 — the buildable facts)

All citations are Microsoft Learn primary docs unless flagged. Numbers here are load-bearing; do not "round" them.

**Auth (Microsoft identity platform v2.0)** [9][10][11]:
- Authorize: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` · Token: `https://login.microsoftonline.com/common/oauth2/v2.0/token`. `/common` = both work/school **and** personal accounts; register the app with `signInAudience = AzureADandPersonalMicrosoftAccount`.
- Authorization Code Grant, confidential web client. Authorize params: `client_id`, `response_type=code`, `redirect_uri` (must match a registered `web`-type URI EXACTLY), `scope` (space-separated), `state`, `response_mode=query`. Token exchange: **`POST` with `Content-Type: application/x-www-form-urlencoded`**, body `client_id`+`scope`+`code`+`redirect_uri`+`grant_type=authorization_code`+`client_secret` (`client_secret` "required for confidential web apps") [9].
- **Refresh tokens ROTATE** — each refresh returns a NEW `refresh_token`; discard the old, persist the newest [9]. `offline_access` **gates** refresh-token issuance (the response omits it otherwise) [9]. Lifetime: **90-day inactivity** for a confidential web app (non-`spa` redirect), no fixed absolute expiry, non-configurable since 2021-01-30 [11]. (The "24-hour" figure is the `spa`-redirect case ONLY — we register a `web` redirect, so we get 90-day inactivity.) → **this is Notion's rotation model; `oauth.refresh_if_needed`'s lock-guard + re-read-after-lock dedupe is exactly correct, reused unchanged.**

**Scopes (exact, current, all AdminConsentRequired = No)** [1][2][3][4]: `Notes.Read` (`371361e4-…`), `Files.Read` (`10465720-…`), `User.Read` (`e1fe6dd8-…`), `offline_access`. Request `onenote`'s app as `openid offline_access User.Read Notes.Read`; `onedrive`'s as `openid offline_access User.Read Files.Read`.

**OneNote (read)** [12][13][14]:
- Enumerate PER SECTION (not globally): `GET /me/onenote/sections/{id}/pages?$select=id,title,lastModifiedDateTime&$top=100&$orderby=createdDateTime desc`. **Global `GET /me/onenote/pages` returns HTTP 400 "maximum number of sections is exceeded" for large accounts** [13] — so walk `GET /me/onenote/notebooks?$expand=sections,sectionGroups($expand=sections)` first to get section ids, then page each section.
- **`$top` max = 100** (default 20). **TRAP:** when `$top` is supplied, OneNote does **NOT** return `@odata.nextLink` — you page manually with `$skip`+`$top` [12][14]. Default sort is `lastModifiedTime desc`; sorting by `lastModifiedDateTime` is documented-slow, prefer `createdDateTime` for stable paging [13].
- **NO delta/change feed for OneNote** [12] — poll `lastModifiedDateTime`, compare to the stored watermark.
- Page content: `GET /me/onenote/pages/{id}/content` → **HTML** (`Accept: text/html`); `?includeIDs=true` adds element ids [12]. No reliable `preAuthenticated` param on v1.0 (do not use it).
- Resources (images/files): `GET /me/onenote/resources/{id}/$value` → binary; **these DO require `Authorization: Bearer` (they are Graph endpoints, NOT pre-authenticated blob URLs)** [12]. HTML `<img>` carries `src` (optimized) + `data-fullres-src` (original); `<object>` carries `data`. One-by-one only.
- **Throttling:** `429 Too Many Requests`, per **app + per user**, time-based [15][16]. ⚠️ **The oft-quoted "400/hour, 120/min, 5 concurrent" are NOT in any current Microsoft doc** — the archived OneNote post publishes no numbers and the current throttling-limits page has **no OneNote row** [15][16]. Treat 400/hr as a legacy/unofficial *planning* figure only. **OneNote 429s do not reliably carry `Retry-After`** [15] → honor it if present, else exponential backoff with jitter; retry only on 429, never other 4xx.

**OneDrive / Files (read + delta)** [17][18]:
- Delta: `GET /me/drive/root/delta` (whole drive) or **`GET /me/drive/items/{folder-id}/delta`** (folder subtree scope — confirmed) [17]. Response carries EITHER `@odata.nextLink` (more in this round — keep calling) OR, on the last page, `@odata.deltaLink` (the DURABLE, OPAQUE cursor for next round). Use the service-provided token verbatim; `?token=latest` fetches just the current cursor. A stale token → **HTTP 410 Gone** with `resyncChanges*` codes + a `Location` for a fresh full enumeration.
- Deletions: an item appears in `value` with a **`"deleted": {}` facet** [17]. Delta returns latest-state-per-item, may repeat an item (use the last occurrence), and **track by `id`** (renames don't re-emit descendants; `parentReference.path` isn't returned).
- Download: `GET /me/drive/items/{id}/content` → **`302 Found`** to a **pre-authenticated** URL (`@microsoft.graph.downloadUrl`); **"You don't need to include an `Authorization` header when you access the download URL"** [18], and it "might expire within minutes" — follow immediately (httpx auto-follows the 302). Supports `Range` (206) and `If-None-Match` (304).
- Throttling: `429`, SharePoint/OneDrive **do** return `Retry-After` [16][18] → honor it + backoff.

---

## 6. OneNote — the durable resumable queue (the hard problem)

OneNote's *content* fetch (1 GET per page + N resource GETs) is the expensive, budget-bounded work; a large notebook (thousands of pages) cannot be drained in one tick under a defensive per-app-per-user budget, and there is **no delta feed** to skip unchanged pages. The design:

### 6.1 Decision: encode progress in the opaque cursor — NO third cursor mode

The engine already has exactly two cursor modes (`providers/base.py::opaque_cursor` docstring): timestamp mode (`max(ref.updated_at)`, Roam/Craft/Notion) and opaque mode (provider hands back a verbatim continuation token, Dropbox). **OneNote uses opaque mode, with the token being a JSON watermark blob** — it needs no third mode, because "opaque, provider-owned, persisted verbatim, handed back next call" is precisely the channel a resumable-enumeration cursor needs.

```
cursor JSON (opaque to the engine, owned by OneNoteProvider):
  {"v":1, "watermark":"2026-08-01T14:30:00Z", "at_watermark_ids":["p1","p2"]}
```

- `watermark` = the `lastModifiedDateTime` of the newest page whose content this source has already fetched+imported.
- `at_watermark_ids` = page ids already processed AT EXACTLY that timestamp (minute/second collisions) — the precise-overlap idiom (wave-1's Notion −2min / Craft −1h, made exact for pacing so no page is skipped or re-looped at the K-boundary).

### 6.2 The drain, per incremental tick (`list_changed(cursor)`)

1. Build the section list (`notebooks?$expand=sections…`, cheap) — a handful of requests.
2. Across sections, enumerate page refs (`$select=id,lastModifiedDateTime`, `$top=100`, `$skip` paging) whose `lastModifiedDateTime` ≥ `watermark`, **excluding** `at_watermark_ids`. Enumeration is CHEAP (ids+timestamps only, ~1 request per 100 pages).
3. Sort the candidate changed pages **ascending** by `lastModifiedDateTime` and return only the **first K** as `RemoteRef`s (K = `MSGRAPH_ONENOTE_PAGES_PER_TICK`, default 40). K bounds this tick's *content* fetches (the engine fetches exactly the refs returned).
4. Publish `self.opaque_cursor` = a JSON blob whose `watermark` = the K-th returned page's `lastModifiedDateTime` (or the newest, if fewer than K changed) and `at_watermark_ids` = the ids at that exact timestamp. The engine persists it verbatim (`engine._do_sync`: opaque cursor takes precedence, stored unconditionally).
5. The engine `fetch`/`fetch_many`s those ≤K refs → HTML content GET + resource GETs → `onenote_html` → import. Next tick resumes from the advanced watermark.

**Why this is a correct resumable queue:** `lastModifiedDateTime` is monotonic (an edit only moves a page's timestamp *forward*). Draining ascending and advancing the watermark to the K-th means the next tick continues past exactly the pages already imported — never re-pulling, never skipping. A page edited *during* the multi-day backfill gets a fresh (larger) timestamp and is re-emitted when the watermark passes it; `import_confirm`'s content hash no-ops it if unchanged. The first-ever sync (cursor `None` → watermark = epoch) drains the whole notebook oldest-first over ⌈total/K⌉ ticks; steady state then just picks up newly-modified pages.

**Backfill math (grounded in the shipped scheduler):** the incremental job fires **hourly at :23 ET**, and `NOTE_SYNC_INTERVAL_MIN`=30 makes each source due once per hour → ~1 content-drain tick/hour/source. At K=40 that is 40 pages/hour; a 2,000-page notebook backfills in ~50 hours (~2 days) of paced background work, then keeps up trivially. A user who wants it faster clicks "Sync now" (bypasses cooldown after 600s). K is tunable (`MSGRAPH_ONENOTE_PAGES_PER_TICK`).

### 6.3 Why a bounded slice (not the full changed set)

If `list_changed` returned every changed page at once, the engine's `_fetch_remote_notes` would fetch content for all of them in one tick — the exact budget blow-out §10 guards against. Bounding the *returned refs* is what paces content fetch; the cursor watermark is what makes it resumable. This is the crux the wave-1 §10 note named.

---

## 7. OneDrive — delta (the Dropbox analog)

OneDrive is genuinely the simpler surface: it *has* a durable delta cursor, so it drops straight into the engine's opaque-cursor mode with no resumable-queue machinery.

- `list_changed(cursor)`: if `cursor` is a stored `deltaLink`/`nextLink`, `GET` it; else start `GET /me/drive/items/{folderId}/delta` (folder-scoped — `source.remote_id` is the drive-item id of the picked folder). Drain `@odata.nextLink` pages up to a per-tick page budget; publish `self.opaque_cursor` = the `@odata.deltaLink` when the round completes, or the interim `@odata.nextLink` if the budget is hit mid-drain (both are resumable continuation tokens — the engine persists whichever verbatim, exactly like Dropbox's `list_folder` cursor). A **410 Gone** → discard the token, restart delta from the folder root, reconcile (the same self-healing shape as Dropbox's `409 {".tag":"reset"}`).
- Deletions: items with the `"deleted": {}` facet are collected and surfaced via **`list_deleted(creds)`** (the engine's existing certain-deletion channel, capped at 20%/pass + the <50%-enumeration refuse guard). Non-deleted items with a note extension become `RemoteRef`s; folders and non-note files are skipped as note candidates (media is resolved by reference, Dropbox-style).
- `fetch`: `GET /me/drive/items/{id}/content` → follow the 302 to the pre-authenticated URL with **no** `Authorization` header [18] → route by extension (§8).
- `import_key`: base default `onedrive:{folderId}/{itemId}` (stable item id — renames don't break it, per Graph's "track by id" guidance [17], an improvement over Dropbox's path-based key).
- Folder picker: `list_folders(creds, path)` → `GET /me/drive/root/children` (or `…/items/{id}/children`) filtered to `folder`-faceted items — served by the generalized `GET /{provider}/folders` endpoint.

OneDrive rides general Graph/SharePoint throttling (not OneNote's per-app-per-user squeeze) and delta is efficient, so it needs no resumable queue; the per-tick page budget is a light safety bound only.

---

## 8. Conversion routing

**OneNote pages (HTML)** → `convert/onenote_html.py::onenote_html_to_tiptap(html)`:
1. Pre-pass (a `roam_text`-style normalization before the shared converter):
   - `data-tag="to-do"` / `data-tag="to-do:completed"` on a `<p>`/`<li>` → emit `<li data-uct-task="0|1">…</li>` inside a `<ul>` (the marker the additive `html_to_tiptap` task-list branch renders as `taskItem(checked)`). This is the one converter capability OneNote needs that `html_to_tiptap` lacks today (it drops `<input type=checkbox>` — mddoc.py ~L665).
   - Resource `<img src="{graphResourceUrl}" data-fullres-src="{…}">` → `<img src="{REF_PREFIX}onenote-res://{resourceId}">` (prefer `data-fullres-src`); registered as a `media` entry. `<object data-attachment data="{resourceUrl}">` → `<a href="{ATTACHMENT_REF_PREFIX}onenote-res://{resourceId}">name</a>` → `attachmentChip`.
   - Strip OneNote's absolute-positioning wrapper `<div style="position:absolute">` (unwrap to children).
   - External `http(s)` images (arbitrary hosts) are left as normal `<img src>` → resolved later by `fetch_media` through the SSRF-guarded, **unauthenticated** `guarded_media_get` (Dropbox-external branch shape).
2. Then `html_to_tiptap` (shared) produces `{doc, media, links}`.

`fetch_media(creds, ref)` two branches (mirrors Dropbox): `onenote-res://{id}` → **authenticated** `GET /me/onenote/resources/{id}/$value` (Bearer attached to `graph.microsoft.com` ONLY — credential-boundary rule, same as Dropbox attaching its token to `dropboxapi.com` only) [12]; genuine external `https://…` → `guarded_media_get` (no auth).

**OneDrive files** → by extension, reusing wave-1 converters unchanged: `.md`→`md_to_tiptap`, `.html`/`.htm`→`html_to_tiptap`, `.txt`→Dropbox's `_txt_to_tiptap` (lift to a shared helper or import). Relative media/attachment references in md/html resolve against the delta-enumerated item index (the Dropbox relative-resolution approach, keyed on drive-item paths). **`.docx` is a documented GAP** — the server has no docx→TipTap converter (docx is client-side-only in the file importer); v1 either skips `.docx` files with a named per-item `NoteConnUnsupported` ("Word documents from OneDrive aren't converted yet — use the file importer") or a future task adds a `python-docx`→markdown path. Be explicit in the UI/log; never silently drop.

**The schema rail (wave-1 §4, mandatory):** every OneNote/OneDrive converter change regenerates the golden fixtures under `app/src/pages/journal-2-0/lib/importer/__fixtures__/server_convert/` and must pass the vitest schema-contract test (`Node.fromJSON(getSchema(buildExtensions()))` + `generateHTML`). A converter task is not done until its fixtures validate in vitest. The additive `taskList` HTML branch and every new OneNote/OneDrive sample get fixtures.

---

## 9. Delete detection across a multi-tick drain (the subtle problem — solved)

**The trap:** the engine runs delete detection only on a **full** pass, over `seen_ids = {r.remote_id for r in refs}`, with a `<50%`-of-known **refuse guard** and a 2-strike miss-streak. For OneNote, if a "full pass" returned only the bounded K refs (§6), each pass would enumerate `<50%` of a large notebook → the refuse guard fires every pass → **delete detection would never run** (deletes never detected). Conversely, returning all changed pages to satisfy delete detection reintroduces the budget blow-out. A full enumeration spanning ticks must feed delete detection a **complete** listing without triggering a full content fetch.

**The resolution — separate "present" from "to-fetch," via one optional engine hook.** Page *enumeration* (ids + `lastModifiedDateTime`, `$select`) is CHEAP and completes in one pass even for a large notebook (2,000 pages ≈ 20 list requests). Content *fetch* is the expensive part that must be paced. So:

- `OneNoteProvider.list_present_refs(creds) -> list[RemoteRef]` — the **complete** present-page id set (cheap enumeration, one tick), ids + timestamps only, no content.
- `engine._do_sync`, on a `full` pass ONLY, does `present = getattr(provider, "list_present_refs", None)`; if present, it uses `present` for `_touch_remote_index` (existence tracking) and for `_run_delete_detection`'s `seen_ids` (complete → the refuse guard passes, miss-streak works normally: 2 consecutive nightly full passes with a page absent → tag `source-deleted` + sever). Meanwhile `list_changed`'s **bounded** refs still drive `_fetch_remote_notes` (content, paced). Present-refs not in the fetch set are touched into the index but not re-fetched (their content was imported in a prior drain and is unchanged).

This is the **only** engine change, and it mirrors the existing `getattr(provider, "list_deleted", None)` seam EXACTLY (optional method, full-pass only, feeds delete detection). Roam/Craft/Notion/Dropbox/OneDrive do not define `list_present_refs` → the engine's behavior for them is byte-for-byte unchanged (refs-drive-everything). The nightly full pass (01:47 ET) is where OneNote deletes are caught; a page genuinely deleted at OneNote is absent from `list_present_refs` on two consecutive nights → severed (note kept, tagged `source-deleted`, per the demote-never-delete rule).

**Rejected alternatives (for the record):**
- *Pure cursor, refetch-all on the full pass* — delete detection works but re-GETs every page's content nightly = tens of hours of budget. Rejected.
- *Pure cursor, bounded full pass* — content stays bounded but delete detection sees `<50%` and refuses forever. Rejected.
- *Encode the whole present-id set in the opaque cursor* — a 10k-id set is ~360 KB of cursor and duplicates what `remote_index` already stores; the engine already does present-vs-known comparison. Rejected.

---

## 10. Rate-limit accounting (per-user-per-app budget across ticks)

The shipped `AsyncRateLimiter` (broker/`rate_limit.py`) is per-provider-**instance**; Microsoft's OneNote budget is per-**user-per-app** and time-based (undocumented magnitude — do NOT hard-code "400/hr" as fact [15][16]). The queue is what keeps us under it:

- **Cross-tick pacing = the cursor + the scheduler cadence.** Each incremental tick is at most one `sync_source` call per source (fresh provider instance = one tick), fires ~1×/hour (scheduler :23 + 30-min due interval), and does bounded content work (≤K pages). So the per-hour request count is `K × (1 + avg_resources) + enumeration`, tunable via K well under any plausible ceiling with headroom for the nightly full pass.
- **Per-tick admission control (in the provider instance):** a request counter with a hard ceiling `MSGRAPH_ONENOTE_MAX_REQUESTS_PER_TICK` (default 500 — raised from an initial 120 once fix-round-1 established that the safe-stall crossover is bound by SECTION COUNT, not page count: each section costs ≥1 enumeration request regardless of how many pages it holds) over the ENUMERATION pass only. If a tick's COMPLETE enumeration (every section, every `$skip` page) would exceed the ceiling, the WHOLE tick is a no-op — the cursor republishes UNCHANGED and zero refs are returned, complete-or-nothing, never a partial advance. (An earlier design bailed mid-enumeration and advanced the watermark off whatever had been scanned so far; fix-round-1 found this could silently and permanently skip an older page sitting in a section the tick never reached, so the ceiling now gates admission to START the pass at all rather than being a checkpoint to resume from mid-pass.) The next tick simply retries the identical cheap enumeration from scratch — a real but rare, self-correcting stall reserved for pathologically large accounts, never data loss. Plus an `AsyncRateLimiter` at a low rps to smooth bursts.
- **429 is the backstop against manual-sync abuse.** A user spamming "Sync now" (which bypasses cooldown after 600s) could momentarily exceed the hourly budget; the provider honors `Retry-After` when present and otherwise backs off with jitter, then bails gracefully (cursor left at the last imported page → resumes). No durable per-hour counter is needed — Graph's own 429 + our backoff + the resumable cursor make over-budget self-correcting. Retry only on 429, never other 4xx (a 400/401/403 is terminal → the taxonomy's auth/unsupported classes).
- OneDrive rides general Graph/SharePoint throttling with reliable `Retry-After` [16][18]; its delta cursor makes steady-state cost minimal.

---

## 11. Schema — no delta, no migration (and why that is safe)

**No new table and no migration v4.** OneDrive's cursor is an opaque `deltaLink` string; OneNote's is an opaque JSON watermark string — both fit `j2_note_sources.cursor` (TEXT), which is exactly what opaque-cursor mode is for. Delete detection uses the existing `j2_note_remote_index` (via `list_present_refs`). The per-tick request budget is per-instance (no persistence). So this wave touches zero DDL.

**Had a table been needed, the wave-1 migration-safety rules would bind (they are cited here as the standard, and this wave deliberately stays inside it):** nothing in `_J2_SCHEMA` may reference a column a later migration adds; a new migration mirrors `run_notebook_migration_v3`'s resumable shape (a `.notebook_migration_vN` flag file + table/column probes + `CREATE TABLE IF NOT EXISTS`), is called AFTER v1/v2/v3 in `ensure_schema`; additive columns use the try/except `ALTER … ADD COLUMN` idiom (SQLite has no `ADD COLUMN IF NOT EXISTS`) guarded on "duplicate column"; new indexes are created AFTER the migration call so they can never reference a not-yet-existing table (see `db.py::ensure_schema` around the v3 block + `idx_j2_note_sources_user`). A test would drive `ensure_schema()` itself on an older-shaped DB. **This wave needs none of that** — which is a feature: no migration risk.

---

## 12. Endpoints & UI — registry-driven, zero new routes

**No new endpoints.** Two one-time generalizations of existing handlers make every generic-OAuth provider (Notion + the two Microsoft providers, and any future one) work with no per-name code:

- `note_sync.py::_start_oauth` and `oauth_callback`: replace the `if provider == "notion" … else dropbox` branch with `if provider in oauth._PROVIDERS:` (the generic `oauth.authorize_url` / `oauth.exchange_code` path Notion already uses) `else` the Dropbox-owned path. After this, `onenote`/`onedrive` flow through the SAME generic OAuth code Notion does.
- `GET /{provider}/folders`: allow `onedrive` alongside `dropbox` (both dispatch to the provider's own `list_folders`). OneDrive's folder-pick → `POST /{provider}/sources` creates the folder-scoped source (Dropbox flow, unchanged).

**Source creation semantics (each maps onto an existing precedent):**
- **OneNote** — Notion-like: connect → the connector IS one implicit source (the whole account's notebooks), auto-created on callback with `remote_id` = the account/user id and a default `"OneNote — {name}"` folder. `import_key` overridden to flat `onenote:{page_id}` (page ids are globally unique within the account; one source per account — the Notion precedent).
- **OneDrive** — Dropbox-like: connect → connector only (no auto source) → folder picker → `POST /{provider}/sources` creates a folder-scoped source (`remote_id` = drive-item folder id). `import_key` = base default `onedrive:{folderId}/{itemId}`.

**UI:** `ConnectedAppsCard` gains two tiles (`onenote`, `onedrive`), both `connect_kind="oauth"`, rendering "Connect" when `configured` and "Not available yet" when the Microsoft Graph app creds are unset — reusing the Notion/Dropbox OAuth-redirect + `?connector=…&connected=1` self-heal path verbatim. OneDrive reuses the Dropbox folder-picker UI; OneNote shows a single whole-account source row. Trust strip / `SourceRow` (freshness, counts, conflicts, Sync now, disconnect) are unchanged. Paid gate + consent checkbox mirror wave 1.

---

## 13. Env vars

- `MSGRAPH_CLIENT_ID` / `MSGRAPH_CLIENT_SECRET` — the ONE Azure app, shared by both providers (`oauth.configured("onenote")` and `oauth.configured("onedrive")` both check these). Per-provider redirect override `ONENOTE_REDIRECT_URI` / `ONEDRIVE_REDIRECT_URI` optional (else derived `{DASHBOARD_URL}/api/j2/notes/connectors/{provider}/callback`).
- **No new encryption key** — tokens use the existing `NoteBox` family (`NOTE_ENCRYPTION_KEY` / `NOTE_ENCRYPTION_KEYS_V<n>`), via `connections.upsert_connector` (the one encrypt site). `crypto_box.NoteBox` already exists.
- `NOTE_SYNC_ENABLED=1` — the shipped scheduler gate (unchanged); the whole wave is inert without it.
- Tunables (all defaulted, provider-read live): `MSGRAPH_ONENOTE_PAGES_PER_TICK` (K, default 40), `MSGRAPH_ONENOTE_MAX_REQUESTS_PER_TICK` (default 500 — see §10; the safe-stall crossover is section count, not page count), `MSGRAPH_ONEDRIVE_PAGES_PER_TICK` (delta-page budget, default 200), `MSGRAPH_HTTP_TIMEOUT_SECONDS` (default 30).
- Reuse: `NOTE_SYNC_INTERVAL_MIN` (default 30), `PUSH_SECRET` (OAuth state signing — already required by the router).

---

## 14. Activation checklist (owner, one-time — no code)

1. **Register the Azure app** (Entra admin center → App registrations → New): `signInAudience = AzureADandPersonalMicrosoftAccount` (multi-tenant + personal). Add a **`web`** platform redirect URI `https://uctintelligence.com/api/j2/notes/connectors/onenote/callback` **and** `…/onedrive/callback` (both, `web` type — NOT `spa`, or refresh tokens drop to 24h [11]).
2. **API permissions** → Microsoft Graph → **Delegated**: `Notes.Read`, `Files.Read`, `User.Read`, `offline_access`. Do NOT add `.All` or application permissions. Leave "Grant admin consent" for the home tenant only.
3. **Certificates & secrets** → new client secret. Set Railway (web pod) `MSGRAPH_CLIENT_ID` + `MSGRAPH_CLIENT_SECRET`, then `railway redeploy --service web --yes`.
4. **Publisher verification** (Entra → Branding & properties → verify): associate the verified Microsoft AI Cloud Partner Program (Partner One ID) account + a publisher domain that is NOT `*.onmicrosoft.com` [8]. Free; removes the "unverified/risky" consent warning that risk-based step-up consent shows to other tenants' work/school users — the practical prerequisite for work/school self-connect (§2).
5. **Admin-consent fallback** (optional but recommended): the app's admin-consent URL `https://login.microsoftonline.com/{tenant}/adminconsent?client_id={MSGRAPH_CLIENT_ID}` is what a work/school member whose tenant blocks user consent hands to their IT admin. Personal-account members need none of this.
6. Flip `NOTE_SYNC_ENABLED=1` if not already on. The tiles light up; no deploy needed for step 3's creds beyond the redeploy.

---

## 15. Global Constraints (this wave)

- **Reuse, don't reinvent.** Both providers implement `providers/base.py::NoteProvider` and raise ONLY the shared `errors` taxonomy outward — never a raw httpx/Graph error. No new engine flow; the ONE engine addition is the optional `list_present_refs` hook (§9), getattr-gated, backward-compatible.
- **Credential boundary (named critical class — both wave-1 live providers had this bug).** The Graph bearer is attached to `graph.microsoft.com` ONLY (OneNote resource fetch, OneDrive delta/metadata); the OneDrive download URL and any external image are fetched with **no** `Authorization` header ([18], and via SSRF-guarded `guarded_media_get`/`assert_public_https` for external content). Never log a token, code, or secret.
- **Import-inert.** Importing any new module with no env set never raises; `configured()` is false until `MSGRAPH_CLIENT_ID`/`SECRET` exist. Env is read live in function bodies, never at import.
- **Ordering (from the wizard, unchanged):** import hash over the PLACEHOLDER body (`import-ref://`/`import-link://`) BEFORE media upload/rewrite; the remote's `lastModifiedDateTime` → the confirm payload's `updatedAt` (it IS the change signal, and OneNote's watermark cursor).
- **Second-authority rail:** every converter change regenerates the schema-rail fixtures; a converter task is not done until vitest validates them.
- **Cursor discipline:** the engine stores `provider.opaque_cursor` verbatim — the provider is the ONLY authority on the OneNote watermark JSON's shape; the engine never parses it.
- **No migration** (§11) — but if that ever changes, the v3 additive/flag-gated/index-after-migration rules bind.
- **Scheduler unchanged** (:23 hourly, 01:47 ET nightly full, `NOTE_SYNC_ENABLED` double-gate). Delete detection reaches OneNote only via the nightly full pass.
- **Router:** no new routes; two one-time generalizations only (§12), each pinned by the existing AST/route-presence test idiom (`tests/test_note_sync_router.py`) with a non-vacuity control.
- **Deps:** no new Python packages (httpx + markdown-it-py already present) → **no `requirements.txt` change, so no `UCT_FLOW_OVERRIDE` review** (unlike wave 1). Confirm in the final report.
- UI: UIcon only (no emoji); breakpoints 640/1024; Sheet idiom; paid gate + consent checkbox mirror `ConnectedAppsCard`.

---

## 16. Testing

Unit (recorded-fixture `httpx.MockTransport`, no live calls): OneDrive delta (nextLink→deltaLink drain, `deleted` facet → `list_deleted`, 410 resync, folder scoping, download-302 follow, extension routing); OneNote watermark drain (ascending K-bound, `at_watermark_ids` overlap at the boundary, `$top`-suppresses-nextLink `$skip` paging, per-section enumeration, `list_present_refs` completeness, resource-media authenticated vs external unauthenticated, 429-without-Retry-After backoff, per-tick request-budget bail-and-resume); OneNote converter (`data-tag` to-do → taskItem, resource img → REF placeholder, absolute-div unwrap) with fixtures through the schema rail; OAuth (form-encoded token exchange, rotation refresh dedupe under the shared lock, `offline_access` refresh-token persistence). Engine: `list_present_refs` used on full pass only, delete detection over the complete set while fetch stays bounded (mutation-checked: remove the hook → OneNote delete detection reverts to refuse-guard-blind; a control proving the seam is load-bearing). Router: `onenote`/`onedrive` in the generic OAuth path, folder-picker allows onedrive, unconfigured tiles render "not available yet", paid gate + consent. Live gate at activation: real personal Microsoft account end-to-end on the sandbox (initial paced drain → notes/folders/media/links → re-sync all-skipped → delete detection over the nightly full pass) + an on-screen Playwright connect→first-sync→renders pass with a mock Graph server.

---

## 17. Rollout

Branch `note-connectors` (this wave extends it). Everything DARK behind `NOTE_SYNC_ENABLED` + `MSGRAPH_CLIENT_ID`/`SECRET`; the tiles render "Not available yet" until the owner completes §14. No migration, no new deps, no `requirements.txt` flow-watch, so the ship is a plain web deploy. Owner activation is the §14 checklist; publisher verification and the admin-consent fallback are owner tasks that gate only the work/school self-connect experience, never the code path.

---

## References

[1] Notes.Read (admin consent = No): https://graphpermissions.merill.net/permission/Notes.Read · canonical https://learn.microsoft.com/en-us/graph/permissions-reference
[2] Files.Read (admin consent = No; personal MSA supported): https://graphpermissions.merill.net/permission/Files.Read
[3] Files.Read.All (delegated admin consent = No; application = Yes): https://graphpermissions.merill.net/permission/Files.Read.All
[4] User.Read (admin consent = No): https://graphpermissions.merill.net/permission/User.Read
[5] User & admin consent overview (policy options; personal accounts exempt): https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/user-admin-consent-overview
[6] Configure user consent (built-in policies microsoft-user-default-low / -legacy): https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent
[7] Permission classifications (low-impact set; only non-admin delegated classifiable): https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-permission-classifications
[8] Publisher verification overview + risk-based step-up consent rule (post-2020-11-08 multitenant): https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview
[9] Auth code flow — endpoints, form-encoded token, client_secret, PKCE optional for confidential, refresh rotation, offline_access: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
[10] v2.0 protocols — {tenant} = common/organizations/consumers: https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols
[11] Configurable token lifetimes — 90-day refresh inactivity (web), non-configurable since 2021-01-30, spa=24h: https://learn.microsoft.com/en-us/entra/identity-platform/configurable-token-lifetimes
[12] OneNote get content & structure — page HTML, includeIDs, resources need Bearer, no delta: https://learn.microsoft.com/en-us/graph/onenote-get-content
[13] OneNote best practices — per-section paging, $select/$expand, 400 on too-many-sections: https://learn.microsoft.com/en-us/graph/onenote-best-practices
[14] List onenotePages — $top max 100, $top suppresses @odata.nextLink: https://learn.microsoft.com/en-us/graph/api/onenote-list-pages?view=graph-rest-1.0
[15] OneNote API throttling (archived) — 429 per app+user, no published numbers, Retry-After not guaranteed: https://learn.microsoft.com/en-us/archive/blogs/onenotedev/onenote-api-throttling-and-how-to-avoid-it
[16] Graph throttling limits — no OneNote row; OneDrive → SharePoint Online throttling: https://learn.microsoft.com/en-us/graph/throttling-limits
[17] driveItem: delta — nextLink/deltaLink opaque durable token, deleted facet, item/folder scoping, 410 resync, track by id: https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0
[18] Download driveItem content — 302 → pre-authenticated URL, no Authorization header, Range/If-None-Match: https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0
