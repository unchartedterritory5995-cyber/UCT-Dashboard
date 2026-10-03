# Notebook routes -- the security review (wave 10, lane 10E-2)

Clause 8b of the 10/10 plan (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`:30, "a security review of
Notebook routes"). Reviewed 2026-09-27 on master `d9e887ca0` (all of wave 10 merged) by an agent
session that built no wave-10 code. **Every Notebook route mounted on the real app is classified
below: 150 method+path pairs, plus 10 routes the census net catches that are not the
Notebook, each excluded with its reason.**

## How this was reviewed, and what holds it

* **The route list is the app's own.** `tests/test_notebook_route_security_census.py` imports
  `api.main:app` under the repo-root conftest's sandbox and walks its route table. Its net is
  deliberately broad: every handler in a Notebook router module, every path naming the notebook,
  every `/api/j2/` path with a Notebook segment, and every path anywhere with a segment containing
  "note". Whatever the net catches is either a row in the census table or an excluded row with a
  reason. **A Notebook route nobody classified fails that test by name**, and so does a row for a
  route the app no longer serves.
* **The columns that can be read off the app are read, not trusted.** The auth class and the paid
  gate come from each route's dependency tree; `dep: ENV` flag gates are EXERCISED (the router's
  own `_require_enabled` must refuse with the variable unset and pass with it set); a `slowapi`
  limit is read from the limiter's registry; every in-handler guard the table names (`none:
  compare_digest`, `in-handler: enforce_rate`, ...) must appear in that handler's source.
* **Controls** (each must be seen failing, and is, in the same file): a planted route under
  `/api/j2/notes/...` the table does not name; two planted routes under names the table has never
  seen (`/api/notebook-v2/pages`, `/api/research/notes-feed`); an auth class changed in the table;
  a route that loses its session dependency while the table still says `session`; a stale row; a
  guard token that is not in the source; a flag gate asked to answer to the wrong variable.
* **The ownership column was MEASURED, not read**, on a census-pinned sandbox (`C:\data-w10e2`,
  port 8216, identity nonce `294f458d6841...`; the integrity verdict is the first line of the lane
  report). `docs/notebook/proof/e2-d9e887ca0/security/cross_tenant_probe.py` made member A one of
  every owned object (note, version, folder, template, saved view, property, inbox capture, image,
  web-capture document and excerpt, fact, evidence, share link, publication, personal token), each
  carrying a random marker, then had member B and the sandbox ADMIN ask every by-id read and every
  by-id write with A's ids, used A's personal token against B's note, and asked every Notebook path
  in the server's own `/openapi.json` with no cookie. Raw records: `cross-tenant-probe-run1.json`
  (shake-out), `-run2.json`, `-run3.json` (the evidence run), committed before this review was
  written.

**Run 3, in one line:** 94 foreign reads, **0 leaks**; the foreign writes changed **nothing of
A's** (A re-read every object afterwards and found it exactly as left); A's bearer on B's note:
refused; 149 anonymous route calls, **none answered 2xx** (the public-token routes answer only a
real token, which the probe's control shows); the planted leak and the planted tamper were both
flagged, so the instrument can fail. A "nothing of theirs" cell below is a 200 whose body carried
none of A's marker: several reads are documented to answer an empty list for a foreign id rather
than 404 (backlinks, related-from, unlinked mentions, share status, the publish context).

## Findings

Severity is the reviewer's: **major** = another member's data or a paid capability is reachable,
**minor** = a hygiene or robustness gap with no cross-member effect. **No major finding.** Nothing
here was fixed during the review; each goes to the controller to file.

| id | route(s) | finding | severity | evidence |
|---|---|---|---|---|
| F-S1 | `POST /api/j2/notes/{note_id}/facts` | Creates a fact owned by the caller while storing a `note_id` the caller does not own (`note_facts.create_fact_observation` never checks the note). Nothing of the other member is read or changed: every fact reader filters on the caller's `user_id` (`public_note_payload.public_facts`, `notes_export`, `ask_retrieval`, `note_facts.list_note_facts`). A dangling reference. | minor | probe run3, B write row: 200; A's objects unchanged |
| F-S2 | `POST /api/j2/notes/{note_id}/facts/{fact_id}/insert` | `notes.append_financial_fact` places a `financialFact` node with ANY fact id in the caller's own note; its docstring says the fact "must already exist against this SAME note_id" but nothing checks it. It resolves to nothing for the caller (every reader is owner-scoped). | minor | probe run3: 200; B's own note and fact list carry nothing of A's |
| F-S3 | `POST /api/j2/notes/connectors/{provider}/sources`, `PUT .../sources/{source_id}` | `destFolderId` is stored without checking it is the member's folder (`connections.create_source` / `set_dest_folder_id`); the write path refuses it later (`notes.import_confirm`: "destination folder not found"), so a sync into another member's folder cannot happen -- the sync fails instead. | minor | code read (`note_connectors/connections.py`:273, `notes.py`:1149) |
| F-S4 | `POST /api/j2/saved-views` | A saved view's spec may name another member's property id; it is stored and resolves to nothing. | minor | probe run3: B's view lists only B's notes |
| S-2 | most JSON writes (notes create/update, import, telemetry, Ask) | No request-size cap before the body is parsed: such a route accepts whatever reaches it, and only field caps apply afterwards. Bounded in production by the edge's per-request limit, not by the app. The routes that DO cap before parse are named in the table (inbound email, Obsidian ingest, personal API, writing help, share expiry). | minor | code read |
| S-3 | image, hero and attachment uploads | The 5 MiB / 25 MiB caps are checked after `await upload.read()` has buffered the whole upload in memory, on the single web process. | minor | `notes.py` `save_note_image` / `save_note_attachment` |
| S-4 | `GET /api/j2/notes/link-targets` | The `ids` list has no count cap (each id is still resolved only inside the member's own notes). | minor | code read |

**Reviewed and found sound** (each was a plausible hole): the attachment route that carries a
user id in its path refuses any id but the session's (403, probe) and anchors its traversal check
on the root; the OAuth callback binds the HMAC state to the SAME signed-in member; the Obsidian
connect code is a full 256-bit HMAC, single-use, 15-minute; inbound email caps the body before
parsing and verifies an HMAC with replay protection; link preview fetches through one shared SSRF
guard (https only, every hop public, no credentials) with a per-member in-flight cap; the
share/publish public routes are rate-limited per client and every mint per member; revoke and
unpublish are deliberately never paid-gated or rate-limited (taking a link down must always work);
`GET /api/j2/notebook-validation-report` has no dependency but checks an admin session or the
PUSH_SECRET bearer, in constant time, before doing anything.

**Out of this census's scope, named so nobody reads it as covered:** Notebook data reached
in-process rather than through a route (the Compass notes tool, Ask's retrieval, the task-reminder
job, account deletion's tombstone replay); the SPA pages `/share/n/...` and `/p/...` (served by the
catch-all, which only reads the `/api/j2/shared` and `/api/j2/published` routes classified here);
production's edge limits (S-2's bound). The vendor zero-retention terms (clause 8's first half) are
an owner item and are not reviewed here.

## The census

Columns: **auth** is the class read off the route's dependencies (`session`, `admin`,
`capture-scope` = a session or a Browser Capture token, `personal-bearer`, `optional-session`,
`none`), with `: <token>` naming the in-handler guard where there is one; **paid** `yes` = a
paid-plan dependency; **flag** `dep: ENV` = the router-level gate; **rate** `slowapi:` = a
decorator limit, `in-handler:` = a limiter call in the handler, `service:` = a quota inside the
service (written, not mechanically checked), `no` = none; **ownership** and **size bound** are the
review's findings; the last column is the anonymous probe's answer.

<!-- ROUTE-CENSUS:BEGIN -->
| method | path | auth | paid | flag | rate | ownership | size bound | anon probe / notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/api/j2/notes/tasks` | session | no | no | no | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/{note_id}/unlinked-mentions` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| GET | `/api/admin/notebook-telemetry` | admin | no | no | no | admin only; aggregate or maintenance, no member note text | n/a (read) | anon 401 |
| GET | `/api/admin/notebook-slo` | admin | no | no | no | admin only; aggregate or maintenance, no member note text | n/a (read) | anon 401 |
| POST | `/api/admin/notebook-slo/run` | admin | no | no | no | admin only; aggregate or maintenance, no member note text | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/admin/notebook-slo/digest` | admin | no | no | no | admin only; aggregate or maintenance, no member note text | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/admin/notebook-soak` | admin | no | no | no | admin only; aggregate or maintenance, no member note text | n/a (read) | anon 401 |
| GET | `/api/j2/link-preview` | session | no | no | in-handler: PER_USER_INFLIGHT | no member data: fetches a public https page (SSRF guard on every hop: https only, public addresses, no credentials) | url <= 2048; page streamed <= 3 MiB, parse capped | anon 401 |
| POST | `/api/j2/notes/{note_id}/writing-help/stream` | session | yes | dep: NOTEBOOK_WRITING_HELP_ENABLED | in-handler: reserve_writing_help | member-scoped; another member's id is refused 404 (probe run3) | _read_payload: 1 MiB cap before parse | anon 401 |
| POST | `/api/j2/notes/{note_id}/writing-help/autofill` | session | yes | dep: NOTEBOOK_WRITING_HELP_ENABLED | in-handler: reserve_writing_help | member-scoped; another member's id is refused 404 (probe run3) | _read_payload: 1 MiB cap before parse | anon 401 |
| GET | `/api/j2/notes/{note_id}/share` | session | no | dep: J2_SHARE_LINKS_ENABLED | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| POST | `/api/j2/notes/{note_id}/share` | session | yes | dep: J2_SHARE_LINKS_ENABLED | in-handler: enforce_rate | member-scoped; another member's id is refused 404 (probe run3) | expiry body read capped (64 KiB) | anon 401 |
| DELETE | `/api/j2/notes/{note_id}/share` | session | no | dep: J2_SHARE_LINKS_ENABLED | no | member-scoped; another member's id is refused 200 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/share/links` | session | no | dep: J2_SHARE_LINKS_ENABLED | no | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| GET | `/api/j2/shared/{token}` | none: resolve_share | no | dep: J2_SHARE_LINKS_ENABLED | in-handler: enforce_rate | public by design: the token/slug is the credential; payload built by the one public reducer (anon placeholder token: 404) | n/a (read) | anon 404 |
| GET | `/api/j2/shared/{token}/att/{sub}/{filename}` | none: resolve_share_attachment | no | dep: J2_SHARE_LINKS_ENABLED | in-handler: enforce_rate | token-scoped to that note's images; path traversal guarded downstream | n/a (read) | anon 404 |
| POST | `/api/j2/telemetry` | session | no | no | no | member-scoped by the session user id (code read) | event allow-list; props sanitized; stored details truncated to 500 chars; the body itself is not size-capped (S-2) | anon 401 |
| GET | `/api/j2/notebook-validation-report` | none: compare_digest | no | no | no | admin session or PUSH_SECRET bearer, checked in-handler; aggregate report, no note text | n/a (read) | anon 401 |
| GET | `/api/j2/notes/export` | session | no | no | in-handler: acquire_export_slot | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| GET | `/api/j2/notes` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/backlinks` | session | no | no | no | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/graph` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/link-targets` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | ids list not capped (S-4); each id is resolved only inside the member's own notes | anon 401 |
| GET | `/api/j2/notes/tags` | session | no | no | no | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/tag-members` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/folder-counts` | session | no | no | no | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/by-folders` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/by-trade-ref` | session | no | no | no | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/favorites` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/recents` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/switcher` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| POST | `/api/j2/notes/batch` | session | no | no | no | member-scoped per note; a foreign id reads not_found (probe run3) | <= 500 ids (NOTE_BATCH_MAX) | anon 401 |
| POST | `/api/j2/notes/daily` | session | no | no | no | member-scoped by the session user id (code read) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/j2/notes/batch/export` | session | no | no | in-handler: acquire_export_slot | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | <= 500 ids (NOTE_BATCH_EXPORT_MAX) | anon 401 |
| GET | `/api/j2/notes/sector-theme-facets` | session | no | no | no | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| POST | `/api/j2/notes/{note_id}/embeds` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/notes/{note_id}/trade-ref/resolve` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | n/a (read) | anon 401 |
| POST | `/api/j2/notes/attachments/gc` | admin | no | no | no | admin only; aggregate or maintenance, no member note text | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/j2/notes/{note_id}/favorite` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| DELETE | `/api/j2/notes/{note_id}/favorite` | session | no | no | no | member-scoped by the session user id (code read) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/j2/notes/{note_id}/opened` | session | no | no | no | no ownership check by design; the recents read joins on user_id (probe run3: nothing leaked) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/notes/{note_id}/versions` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/{note_id}/versions/{version_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | n/a (read) | anon 401 |
| POST | `/api/j2/notes/{note_id}/versions/{version_id}/restore` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/notes/{note_id}/export` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/{note_id}/backlinks` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/{note_id}/related-from` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/{note_id}/properties` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/property-defs` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| POST | `/api/j2/property-defs` | session | no | no | no | member-scoped by the session user id (code read) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| PUT | `/api/j2/property-defs/{property_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| DELETE | `/api/j2/property-defs/{property_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/saved-views` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| POST | `/api/j2/saved-views` | session | no | no | no | member-scoped; a spec naming another member's property id is stored (F-S4) and resolves to nothing (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| PUT | `/api/j2/saved-views/{view_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| DELETE | `/api/j2/saved-views/{view_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/j2/notes/{note_id}/facts` | session | no | no | no | the fact is owned by the caller; the note_id is NOT checked to be the caller's (F-S1: a dangling reference; no read or write of the other member's data, probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/notes/{note_id}/facts` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| POST | `/api/j2/notes/{note_id}/facts/{fact_id}/insert` | session | no | no | no | the note must be the caller's; the fact id is NOT checked (F-S2: a dangling node; every fact reader is owner-scoped, probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| PUT | `/api/j2/facts/{fact_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| DELETE | `/api/j2/facts/{fact_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/j2/notes/{note_id}/evidence` | session | no | no | no | member-scoped; another member's id is refused 400 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/notes/{note_id}/evidence` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| DELETE | `/api/j2/evidence/{evidence_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/notes/{note_id}/thesis-summary` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | n/a (read) | anon 401 |
| POST | `/api/j2/notes/{note_id}/reviews` | session | no | no | no | member-scoped; another member's id is refused 400 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/notes/{note_id}/reviews` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/notebook/home` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/research/{symbol}/summary` | session | no | no | no | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| GET | `/api/j2/inbox` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| POST | `/api/j2/inbox` | session | no | no | no | member-scoped by the session user id (code read) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| DELETE | `/api/j2/inbox/{capture_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/j2/notes/import/check` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/j2/notes/import/confirm` | session | no | no | no | member-scoped; a foreign destFolderId is refused (probe run3) | <= 500 notes per batch; the body is not size-capped before parse (S-2) | anon 401 |
| POST | `/api/j2/notes/enrichment/scan` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/notes/{note_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | n/a (read) | anon 401 |
| POST | `/api/j2/ask/stream` | session | yes | no | service: note_ask per-member daily count + shared dollar cap + one stream at a time | member-scoped; another member's id is refused 404 (probe run3) | query length capped (_ASK_MAX_QUERY); body not size-capped before parse (S-2) | anon 401 |
| POST | `/api/j2/notes/{note_id}/ask/stream` | session | yes | no | service: note_ask per-member daily count + shared dollar cap + one stream at a time | member-scoped; another member's id is refused 404 (probe run3) | query length capped (_ASK_MAX_QUERY); body not size-capped before parse (S-2) | anon 401 |
| POST | `/api/j2/notes` | session | no | no | no | member-scoped; a foreign folderId is refused (probe run3) | bodyJson <= 1 MB serialized (MAX_BODY_JSON_BYTES), title/subtitle/tag caps; the request is not size-capped before parse (S-2) | anon 401 |
| PUT | `/api/j2/notes/{note_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | bodyJson <= 1 MB serialized (MAX_BODY_JSON_BYTES); the request is not size-capped before parse (S-2) | anon 401 |
| DELETE | `/api/j2/notes/{note_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/note-templates` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| POST | `/api/j2/note-templates` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/note-templates/{template_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | n/a (read) | anon 401 |
| PATCH | `/api/j2/note-templates/{template_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| DELETE | `/api/j2/note-templates/{template_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| PATCH | `/api/j2/notes/{note_id}/lock` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| PATCH | `/api/j2/notes/{note_id}/tags` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| PATCH | `/api/j2/notes/{note_id}/archive` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/j2/notes/{note_id}/restore` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/j2/notes/{note_id}/images` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | 5 MiB (_MAX_IMAGE_BYTES), MIME allow-list; the cap is checked AFTER the whole upload is read (S-3) | anon 401 |
| POST | `/api/j2/notes/{note_id}/hero` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | 5 MiB (_MAX_IMAGE_BYTES), MIME allow-list; the cap is checked AFTER the whole upload is read (S-3) | anon 401 |
| DELETE | `/api/j2/notes/{note_id}/hero` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/j2/notes/{note_id}/attachments` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | 25 MiB (_MAX_FILE_BYTES), MIME allow-list; checked AFTER the whole upload is read (S-3) | anon 401 |
| GET | `/api/j2/notes/attachments/{user_id_param}/{note_id}/{sub}/{filename}` | session | no | no | no | the path's user id must equal the session's (403 otherwise; probe run3); root-anchored traversal guard | n/a (read) | anon 401 |
| GET | `/api/j2/notes/{note_id}/documents` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/documents/{document_id}/pages/{page_number}/text` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/documents/search` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| POST | `/api/j2/capture` | capture-scope | no | no | no | principal id from the session or a capture-scoped token; a foreign noteId is refused (probe run3) | passage/title caps (web_capture.sanitize_text); tier allow-list | anon 401 |
| POST | `/api/j2/notes/{note_id}/excerpts` | session | no | no | no | member-scoped by the session user id (code read) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/notes/{note_id}/evidence-candidates` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/notes/{note_id}/excerpts` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/excerpts/{excerpt_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | n/a (read) | anon 401 |
| PATCH | `/api/j2/excerpts/{excerpt_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/notes/excerpts/search` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| GET | `/api/j2/note-folders` | session | no | no | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| POST | `/api/j2/note-folders` | session | no | no | no | member-scoped by the session user id (code read) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| PUT | `/api/j2/note-folders/{folder_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| DELETE | `/api/j2/note-folders/{folder_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/publish` | session | no | dep: NOTEBOOK_PUBLISH_ENABLED | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| POST | `/api/j2/publish/notes/{note_id}` | session | yes | dep: NOTEBOOK_PUBLISH_ENABLED | in-handler: _mint_limit | member-scoped; another member's id is refused 404 (probe run3) | expiry body only (read_expiry) | anon 401 |
| POST | `/api/j2/publish/folders/{folder_id}` | session | yes | dep: NOTEBOOK_PUBLISH_ENABLED | in-handler: _mint_limit | member-scoped; another member's id is refused 404 (probe run3) | expiry body only (read_expiry) | anon 401 |
| POST | `/api/j2/publish/{slug}/refresh` | session | yes | dep: NOTEBOOK_PUBLISH_ENABLED | in-handler: _mint_limit | member-scoped; another member's id is refused 404 (probe run3) | expiry body only (read_expiry) | anon 401 |
| PATCH | `/api/j2/publish/{slug}` | session | yes | dep: NOTEBOOK_PUBLISH_ENABLED | no | member-scoped; another member's id is refused 404 (probe run3) | expiry body only (read_expiry) | anon 401 |
| DELETE | `/api/j2/publish/{slug}` | session | no | dep: NOTEBOOK_PUBLISH_ENABLED | no | member-scoped; another member's id is refused 200 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/published/{slug}` | none: resolve | no | dep: NOTEBOOK_PUBLISH_ENABLED | in-handler: _public_limit | public by design: the token/slug is the credential; payload built by the one public reducer | n/a (read) | anon 404 |
| GET | `/api/j2/published/{slug}/n/{pid}` | none: resolve_member | no | dep: NOTEBOOK_PUBLISH_ENABLED | in-handler: _public_limit | public by design: the token/slug is the credential; payload built by the one public reducer; member page scoped to the published folder | n/a (read) | anon 404 |
| GET | `/api/j2/published/{slug}/att/{sub}/{filename}` | none: resolve_attachment | no | dep: NOTEBOOK_PUBLISH_ENABLED | in-handler: _public_limit | slug-scoped images | n/a (read) | anon 404 |
| GET | `/api/j2/published/{slug}/n/{pid}/att/{sub}/{filename}` | none: resolve_attachment | no | dep: NOTEBOOK_PUBLISH_ENABLED | in-handler: _public_limit | slug- and page-scoped images | n/a (read) | anon 404 |
| GET | `/api/j2/export/notebook` | session | no | no | in-handler: acquire_export_slot | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| GET | `/api/j2/export/notes/{note_id}` | session | no | no | in-handler: _SINGLE_NOTE_SLOTS | member-scoped; another member's id is refused 404 (probe run3) | n/a (read) | anon 401 |
| POST | `/api/j2/onboarding/sample-notebook` | session | yes | dep: NOTEBOOK_ONBOARDING_ENABLED | service: one seed per member (SampleRefused / SampleBusy) | member-scoped by the session user id (code read) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/onboarding/sample-notebook` | session | no | dep: NOTEBOOK_ONBOARDING_ENABLED | no | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| DELETE | `/api/j2/onboarding/sample-notebook` | session | no | dep: NOTEBOOK_ONBOARDING_ENABLED | no | member-scoped by the session user id (code read) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/j2/capture/authorize` | session | no | no | slowapi: 10 per 1 minute | member-scoped by the session user id (code read) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/j2/capture/token` | none: exchange_authorization_code | no | no | slowapi: 20 per 1 minute | the single-use 120 s code is the credential; mints a capture-scoped token | small JSON (code, redirectUri, clientId, label) | anon 400 |
| GET | `/api/j2/capture/destinations` | capture-scope | no | no | no | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| GET | `/api/j2/capture/connections` | session | no | no | no | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| DELETE | `/api/j2/capture/connections/{token_id}` | session | no | no | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/j2/personal/tokens` | session | yes | dep: NOTEBOOK_PERSONAL_API_ENABLED | no | member-scoped by the session user id (code read) | label only, read in-handler | anon 401 |
| GET | `/api/j2/personal/tokens` | session | no | dep: NOTEBOOK_PERSONAL_API_ENABLED | no | member-scoped; another member's id answers 200 with nothing of theirs (probe run3) | n/a (read) | anon 401 |
| DELETE | `/api/j2/personal/tokens/{token_id}` | session | no | dep: NOTEBOOK_PERSONAL_API_ENABLED | no | member-scoped; another member's id is refused 404 (probe run3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/j2/personal/notes` | personal-bearer | no | dep: NOTEBOOK_PERSONAL_API_ENABLED | service: personal_scope 30/minute per token | member-scoped by the session user id (code read) | read capped at MAX_MARKDOWN_BYTES + 16 KiB before parse | anon 401 |
| POST | `/api/j2/personal/notes/{note_id}/append` | personal-bearer | no | dep: NOTEBOOK_PERSONAL_API_ENABLED | service: personal_scope 30/minute per token | bearer resolves to one member; another member's note id is refused (probe run3, A-bearer row) | read capped at MAX_MARKDOWN_BYTES + 16 KiB before parse | anon 401 |
| POST | `/api/j2/personal/daily/append` | personal-bearer | no | dep: NOTEBOOK_PERSONAL_API_ENABLED | service: personal_scope 30/minute per token | member-scoped by the session user id (code read) | read capped at MAX_MARKDOWN_BYTES + 16 KiB before parse | anon 401 |
| POST | `/api/j2/inbound-email` | none: verify_signature | no | dep: NOTEBOOK_INBOUND_EMAIL_ENABLED | service: per-address and per-member drop rates (inbound_email) | HMAC over the raw body + timestamp, replay-claimed; the address maps to one member | read capped at MAX_BODY_BYTES (36 MiB) BEFORE parse, else 413 | anon 401 |
| GET | `/api/j2/inbound-email/address` | session | yes | dep: NOTEBOOK_INBOUND_EMAIL_ENABLED | no | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| POST | `/api/j2/inbound-email/address` | session | yes | dep: NOTEBOOK_INBOUND_EMAIL_ENABLED | no | member-scoped by the session user id (code read) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| PUT | `/api/upb/entries/{entry_id}/note-links` | session | no | no | no | Notebook-adjacent: every linked note id is ownership-checked against j2_notes (code read) | <= MAX_NOTE_LINKS_PER_ENTRY ids |  |
| GET | `/api/j2/notes/connectors/status` | session | no | no | no | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| POST | `/api/j2/notes/connectors/{provider}/connect` | session | yes | no | no | member-scoped by the session user id (code read) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/notes/connectors/{provider}/callback` | optional-session: _verify_state | no | no | no | HMAC state bound to the SAME signed-in member (a state redeemed in another session is refused) | n/a (read) | anon 400 |
| GET | `/api/j2/notes/connectors/{provider}/folders` | session | yes | no | no | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| POST | `/api/j2/notes/connectors/{provider}/sources` | session | yes | no | no | member-scoped; destFolderId is NOT validated at store time, refused at write time (F-S3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| POST | `/api/j2/notes/connectors/sources/{source_id}/sync` | session | yes | no | service: engine.sync_source 10-minute cooldown per source | member-scoped by the session user id (code read) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| PUT | `/api/j2/notes/connectors/sources/{source_id}` | session | yes | no | no | member-scoped; destFolderId is NOT validated at store time, refused at write time (F-S3) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| DELETE | `/api/j2/notes/connectors/{provider}` | session | yes | no | no | member-scoped by the session user id (code read) | JSON body; field caps in the service; no request-size cap before parse (S-2) | anon 401 |
| GET | `/api/j2/notes/connectors/sources/{source_id}/log` | session | no | no | no | member-scoped by the session user id (code read) | n/a (read) | anon 401 |
| POST | `/api/j2/notes/connectors/obsidian/redeem` | none: redeem_connect_code | no | no | no (by design: 256-bit HMAC code, single use, 15 min TTL; see the handler docstring) | the signed connect code embeds the minting member | pydantic body (code, vaultId, label) | anon 422 |
| POST | `/api/j2/notes/connectors/obsidian/ingest` | none: _authenticate_obsidian_device | in-handler: _require_paid_device_user | in-handler: configured() | no | device token resolves to one member + vault | 2,000,000 bytes: a larger declared length is refused and the read is bounded (_MAX_OBSIDIAN_INGEST_BYTES) | anon 503 |
| GET | `/api/j2/template-gallery` | session | no | dep: NOTEBOOK_TEMPLATE_GALLERY_ENABLED | no | approved + visible templates only; section=mine is the session member's own submissions (code read, wave 12 12A) | n/a (read; at most 200 rows) | anon 404 while dark |
| GET | `/api/j2/template-gallery/admin/queue` | admin | no | dep: NOTEBOOK_TEMPLATE_GALLERY_ENABLED | no | admin only; reporter ids never leave the queue | n/a (read; at most 200 rows per list) | anon 404 while dark |
| GET | `/api/j2/template-gallery/{gallery_id}` | session | no | dep: NOTEBOOK_TEMPLATE_GALLERY_ENABLED | no | a pending, rejected or hidden template answers the one 404 to everyone but its author and admins (code read) | n/a (read) | anon 404 while dark |
| POST | `/api/j2/template-gallery` | session | yes | dep: NOTEBOOK_TEMPLATE_GALLERY_ENABLED | in-handler: enforce_rate | member-scoped: the server reads the member's own template by id; another member's id answers 404 | JSON object read in the dependency chain after the session (_read_json, 256,000 bytes); field caps in the service; reduced body at most 200,000 bytes | anon 404 while dark |
| DELETE | `/api/j2/template-gallery/{gallery_id}` | session | no | dep: NOTEBOOK_TEMPLATE_GALLERY_ENABLED | no | author-scoped: DELETE ... WHERE user_id = the session member; firm rows cannot match | n/a | anon 404 while dark |
| POST | `/api/j2/template-gallery/{gallery_id}/use` | session | no | dep: NOTEBOOK_TEMPLATE_GALLERY_ENABLED | no | writes only into the session member's own j2_note_templates; invisible templates answer 404 | no body | anon 404 while dark |
| POST | `/api/j2/template-gallery/{gallery_id}/report` | session | no | dep: NOTEBOOK_TEMPLATE_GALLERY_ENABLED | in-handler: enforce_rate | one report per member per template; own template refused 400 | JSON object read in the dependency chain after the session (_read_json, 256,000 bytes); field caps in the service; note at most 500 chars | anon 404 while dark |
| PATCH | `/api/j2/template-gallery/admin/items/{gallery_id}` | admin | no | dep: NOTEBOOK_TEMPLATE_GALLERY_ENABLED | no | admin only; hide/unhide is a visibility column, never a delete | JSON object read in the dependency chain after the session (_read_json, 256,000 bytes); field caps in the service | anon 404 while dark |
| PATCH | `/api/j2/template-gallery/admin/reports/{report_id}` | admin | no | dep: NOTEBOOK_TEMPLATE_GALLERY_ENABLED | no | admin only; acts on OPEN reports | JSON object read in the dependency chain after the session (_read_json, 256,000 bytes); field caps in the service | anon 404 while dark |
| GET | `/api/j2/earnings-prep/soon` | session | yes | dep: NOTEBOOK_EARNINGS_PREP_ENABLED | no | member-scoped: the session member's own watchlists, flagged names and positions only (code read, wave 13 13C) | n/a (read; one cached calendar walk, the member's own sets) | anon 404 while dark |
| POST | `/api/j2/earnings-prep/{symbol}/draft` | session | yes | dep: NOTEBOOK_EARNINGS_PREP_ENABLED | in-handler: daily_counters.take | member-scoped: the member's own notes, trades and positions; market facts are company-level and shared; writes no note (code read, wave 13 13C) | no body; symbol validated (at most 10 characters, letters, digits, dot or dash) | anon 404 while dark |
| GET | `/api/j2/plan-grades/trades/{trade_id}` | session | no | dep: NOTEBOOK_PLAN_GRADING_ENABLED | no | member-scoped: the trade is read WHERE user_id = the session member; another member's id answers 404 (code read, wave 13 13A). May freeze the first plan match into j2_trade_plan_links (INSERT OR IGNORE); never writes a trade or a note | n/a (read) | anon 404 while dark |
| POST | `/api/j2/plan-grades/trades/{trade_id}/relink` | session | no | dep: NOTEBOOK_PLAN_GRADING_ENABLED | no | member-scoped: the trade, the note and the verdict are each read WHERE user_id = the session member; another member's ids answer 404/400 (code read, wave 13 13A) | JSON object read in the dependency chain after the session (_read_json, 16,000 bytes) | anon 404 while dark |
| GET | `/api/j2/plan-grades/status` | session | no | dep: NOTEBOOK_PLAN_GRADING_ENABLED | no | member-scoped: ids are matched WHERE user_id = the session member; another member's ids are simply absent (code read, wave 13 13A) | at most 200 ids, query at most 20,000 chars | anon 404 while dark |
| GET | `/api/j2/plan-grades/discipline` | session | no | dep: NOTEBOOK_PLAN_GRADING_ENABLED | no | member-scoped by the session user id; accountId only narrows the member's own trades (code read, wave 13 13A) | n/a (read; the last 60 closed trades) | anon 404 while dark |
| GET | `/api/j2/voice-notes/status` | session | yes | dep: NOTEBOOK_VOICE_NOTES_ENABLED | no | member-scoped by the session user id: this month's minutes and today's summaries (code read, wave 11 11A) | n/a (read) | anon 404 while dark (router gate runs before the session; code read, not probed) |
| POST | `/api/j2/voice-notes/jobs` | session | yes | dep: NOTEBOOK_VOICE_NOTES_ENABLED | service: at most 2 open jobs per member (MAX_OPEN_JOBS_PER_MEMBER) and the monthly dictation minutes, checked against the whole file before any transcription (check_cap) | the job belongs to the session member; the audio is held only in this process's temp directory, never a note, a database or the data volume (code read) | multipart read in the dependency chain after the gate and the paid check (_read_audio, 1 file, 4 fields): a declared Content-Length over MAX_UPLOAD_BYTES + 1 MiB is refused 413 before parse; a body with NO declared length is parsed first and then refused by the service's 90 MiB read cap (create_job); at most 60 minutes of audio | anon 404 while dark (router gate runs before the session; code read, not probed) |
| POST | `/api/j2/voice-notes/jobs/{job_id}/transcribe` | session | yes | dep: NOTEBOOK_VOICE_NOTES_ENABLED | service: one part per call under the job's lock (409 while busy); each part billed to the monthly dictation minutes | member-scoped; another member's job id answers the same 404 as a missing one (vn.get_job, code read) | no body | anon 404 while dark (router gate runs before the session; code read, not probed) |
| DELETE | `/api/j2/voice-notes/jobs/{job_id}` | session | yes | dep: NOTEBOOK_VOICE_NOTES_ENABLED | no | member-scoped; another member's job id answers 200 and drops nothing (discard_job swallows get_job's 404; code read) | no body | anon 404 while dark (router gate runs before the session; code read, not probed) |
| POST | `/api/j2/voice-notes/jobs/{job_id}/summarize` | session | yes | dep: NOTEBOOK_VOICE_NOTES_ENABLED | service: in _summarize, the per-member daily count (reserve_voice_note, NOTEBOOK_VOICE_NOTES_PERUSER_CAP default 20), the shared dollar cap, the population cap and one concurrent stream | member-scoped; another member's job id answers 404 (vn.get_job); the server writes no note (code read) | no body; the text sent is the job's own transcript | anon 404 while dark (router gate runs before the session; code read, not probed) |
| GET | `/api/j2/voice-notes/desk-sessions` | session | yes | dep: NOTEBOOK_VOICE_NOTES_ENABLED | no | not member data: the firm's Desk catalog (edu_videos rows that carry a transcript), lean columns only, paid-gated like the Desk transcript route (code read) | n/a (read; at most 40 rows) | anon 404 while dark (router gate runs before the session; code read, not probed) |
| POST | `/api/j2/voice-notes/desk-sessions/{video_id}/summarize` | session | yes | dep: NOTEBOOK_VOICE_NOTES_ENABLED | service: in _summarize, the same per-member daily count, shared dollar cap, population cap and concurrent stream as a job summary | not member data: any paid member may summarize any Desk transcript (PR #263 owner decision 2); an unknown or transcript-less video answers 404; the server writes no note (code read) | no body; video_id is an integer path parameter | anon 404 while dark (router gate runs before the session; code read, not probed) |
| POST | `/api/j2/ai-actions/plan` | session | yes | dep: NOTEBOOK_AI_ACTIONS_ENABLED | in-handler: reserve_ai_actions | candidates are read only from the member's own live notes (build_context); validate_plan drops any target that is not the member's, trashed or locked; writes only the member's own change-set rows, never a note (code read, wave 11 11C) | JSON body streamed in the dependency chain after the gate and the paid check, refused 422 past 256 KiB (_read_json); request at most 1,000 chars (parse_request) | anon 404 while dark (router gate runs before the session; code read, not probed); the reservation is the per-member daily count (NOTEBOOK_AI_ACTIONS_PERUSER_CAP default 20), then the shared dollar cap, the population cap and one concurrent stream |
| GET | `/api/j2/ai-actions` | session | no | dep: NOTEBOOK_AI_ACTIONS_ENABLED | no | member-scoped: WHERE user_id = the session member; noteId narrows to the member's own sets that applied a change to that note (code read) | n/a (read; at most 20 sets) | anon 404 while dark (router gate runs before the session; code read, not probed) |
| GET | `/api/j2/ai-actions/{set_id}` | session | no | dep: NOTEBOOK_AI_ACTIONS_ENABLED | no | tenant-scoped: another member's set answers the same 404 as none (get_change_set, code read) | n/a (read) | anon 404 while dark (router gate runs before the session; code read, not probed) |
| POST | `/api/j2/ai-actions/{set_id}/apply` | session | no | dep: NOTEBOOK_AI_ACTIONS_ENABLED | no | the set resolves through get_change_set (another member's answers 404); each change is re-checked against the member's own note at the revision reviewed, a conflict skipped and reported; each change is claimed once, so a double submit cannot apply it twice (code read) | JSON body streamed in the dependency chain after the gate and the session, refused 422 past 256 KiB (_read_json); changeIds and declinedIds at most 200 ids each (_ids, MAX_CHANGES) | anon 404 while dark (router gate runs before the session; code read, not probed) |
| POST | `/api/j2/ai-actions/{set_id}/undo` | session | no | dep: NOTEBOOK_AI_ACTIONS_ENABLED | no | another member's set answers 404 (get_change_set); a note edited since the apply is refused and named, never partly reverted (code read) | JSON body streamed after the gate and the session, read and ignored, 256 KiB (_read_json) | anon 404 while dark (router gate runs before the session; code read, not probed) |
| GET | `/api/j2/notebook-fingerprint/meta` | session | yes | dep: NOTEBOOK_TA_FINGERPRINT_ENABLED | no | no member data: the field list and the missing-data codes (code read, wave 13 13I-1) | n/a (read) | anon 404 while dark (router gate runs before the session; code read, not probed) |
| GET | `/api/j2/notebook-fingerprint/compute` | session | yes | dep: NOTEBOOK_TA_FINGERPRINT_ENABLED | no | no member data: a fingerprint of a public symbol from the local bars store, the screener row and the confirmed pattern store; nothing stored (code read) | symbol at most 16 chars, asOf at most 10 (Query max_length); a future day refused 422 | anon 404 while dark (router gate runs before the session; code read, not probed) |
| GET | `/api/j2/notebook-fingerprint/blocks` | session | yes | dep: NOTEBOOK_TA_FINGERPRINT_ENABLED | no | member-scoped: catch_up and list_blocks read WHERE user_id = the session member, joined to the member's own live notes; never writes a note (code read) | n/a (read; at most 200 rows, limit capped at 200) | anon 404 while dark (router gate runs before the session; code read, not probed) |
| GET | `/api/j2/notebook-fingerprint/blocks/{note_id}/{embed_key}` | session | yes | dep: NOTEBOOK_TA_FINGERPRINT_ENABLED | no | member-scoped: another member's note answers the one 404 (get_block WHERE user_id = the session member; code read) | n/a (read) | anon 404 while dark (router gate runs before the session; code read, not probed) |
| POST | `/api/j2/notebook-fingerprint/blocks/{note_id}/{embed_key}/freeze` | session | yes | dep: NOTEBOOK_TA_FINGERPRINT_ENABLED | no | member-scoped: freezes only a block found in the member's own note, from that note's own symbol and day (never a client-supplied pair); another member's note answers 404; writes only the member's own ledger row, INSERT OR IGNORE (code read) | no body | anon 404 while dark (router gate runs before the session; code read, not probed) |
| POST | `/api/j2/chart-plan/size` | session | no | dep: NOTEBOOK_CHART_PLAN_ENABLED | no | member-scoped: reads only the member's own account settings (accounts.get_account_settings with the session id); the plan is read from the drawings in the body by plan_extract and nothing is stored; Compass sizing is asked only for a paid member; never writes a note (code read, wave 13 13H-1) | JSON body streamed in the dependency chain after the gate and the session, refused 422 past 256 KiB (_read_json); annotations must be a list | anon 404 while dark (router gate runs before the session; code read, not probed) |
| POST | `/api/j2/chart-plan/alerts` | session | no | dep: NOTEBOOK_CHART_PLAN_ENABLED | no | member-scoped: the chart is found in the member's OWN live note (j2_notes WHERE id AND user_id AND deleted_at IS NULL) and the ticker is that block's params.symbol, never the client's; another member's note, a trashed note or a missing chart answer the one 404; the alert row is created by the existing watchlist-alert route function for the session member, bound to drawingId; never writes a note (code read) | JSON body streamed after the gate and the session, 256 KiB (_read_json); noteId/embedId/drawingId at most 200 chars; the alert fields are validated by the existing AlertCreate model (422) | anon 404 while dark (router gate runs before the session; code read, not probed) |
| GET | `/api/j2/entry-context/meta` | session | yes | dep: NOTEBOOK_ENTRY_CONTEXT_ENABLED | no | no member data: the field list, the missing codes and the limits (code read, wave 13 13E-1) | n/a (read) | anon 404 while dark (router gate runs before the session; code read, not probed) |
| GET | `/api/j2/entry-context` | session | yes | dep: NOTEBOOK_ENTRY_CONTEXT_ENABLED | no | member-scoped: get_context reads WHERE user_id = the session member; another member's key answers not_captured (code read) | symbol at most 16 chars, entryDay at most 10 (Query max_length); a malformed day refused 422 | anon 404 while dark (router gate runs before the session; code read, not probed) |
| GET | `/api/j2/entry-context/list` | session | yes | dep: NOTEBOOK_ENTRY_CONTEXT_ENABLED | no | member-scoped: list_contexts reads WHERE user_id = the session member (code read) | n/a (read; at most 500 rows, limit capped at 500) | anon 404 while dark (router gate runs before the session; code read, not probed) |
| GET | `/api/j2/entry-context/position/{position_id}` | session | yes | dep: NOTEBOOK_ENTRY_CONTEXT_ENABLED | no | member-scoped: the position is read WHERE user_id = the session member, another member's id answers the one 404; may freeze the member's own row for today's entry, INSERT OR IGNORE; never writes j2_positions (code read) | n/a (read; no body) | anon 404 while dark (router gate runs before the session; code read, not probed) |
| GET | `/api/j2/entry-context/trade/{trade_id}` | session | yes | dep: NOTEBOOK_ENTRY_CONTEXT_ENABLED | no | member-scoped: the trade is read WHERE user_id = the session member, another member's id answers the one 404; joined by (symbol, entry day), never the sentinel position id; never writes j2_trades (code read) | n/a (read; no body) | anon 404 while dark (router gate runs before the session; code read, not probed) |
| PUT | `/api/j2/entry-context/why` | session | yes | dep: NOTEBOOK_ENTRY_CONTEXT_ENABLED | no | member-scoped: set_why UPDATEs only the why columns of the session member's own row; a key with no captured row answers 409 (code read) | JSON object read in the dependency chain after the session (_read_json, 8,192 bytes); text at most 500 chars (WHY_MAX_CHARS), else 422 | anon 404 while dark (router gate runs before the session; code read, not probed) |
| POST | `/api/j2/entry-context/backfill` | session | yes | dep: NOTEBOOK_ENTRY_CONTEXT_ENABLED | no | member-scoped: freezes only the session member's own open positions, at most 25 a call (BACKFILL_BUDGET), INSERT OR IGNORE, labelled captured late; never writes j2_positions (code read) | no body | anon 404 while dark (router gate runs before the session; code read, not probed) |
<!-- ROUTE-CENSUS:END -->

## Excluded -- caught by the net, not the Notebook

<!-- ROUTE-EXCLUDED:BEGIN -->
| method | path | why it is not a Notebook route |
|---|---|---|
| GET | `/api/auth/admin/users/{user_id}/notes` | admin notes ABOUT a member (auth router), not Notebook notes |
| POST | `/api/auth/admin/users/{user_id}/notes` | admin notes ABOUT a member (auth router), not Notebook notes |
| GET | `/api/j2/trades/export` | Journal trades CSV export (caught by the `export` segment), not the Notebook |
| PUT | `/api/j2/calendar/day/{date}/notes` | Journal day reflection notes (j2_day_notes), not the Notebook |
| PUT | `/api/watchlists/{wl_id}/items/{item_id}/notes` | a watchlist item's note field, not the Notebook |
| GET | `/api/coaching-notes` | intelligence router coaching notes, not the Notebook |
| GET | `/api/admin/catalyst-notes` | catalyst engine notes (admin), not the Notebook |
| GET | `/api/education/video-notes` | Desk video notes (education router), not the Notebook |
| POST | `/api/education/video-notes` | Desk video notes (education router), not the Notebook |
| DELETE | `/api/education/video-notes/{note_id}` | Desk video notes (education router), not the Notebook |
<!-- ROUTE-EXCLUDED:END -->
