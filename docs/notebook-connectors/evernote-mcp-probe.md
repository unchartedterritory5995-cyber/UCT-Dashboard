# Evernote MCP probe -- result: GO (2026-11-02)

Run by the owner's session against the owner's own account (Evernote **Advanced**, paid through
2027-03-23). Read scope only. Tokens deleted after the run. No note content is recorded here;
only shapes and counts. Raw `tools/list`: `evernote-probe-2026-11-02/tools_list.json` (27 tools).

| Go criterion (spec section 6) | Result |
|---|---|
| Whole-library enumeration | YES. `search_notes` with `query:""`, `maxResults` 1-100, `startIndex` offset; `structuredContent` = `{hits, totalResultCount, startIndex, isLastPage}`. 3 pages = 215 hits = 215 unique note ids = `totalResultCount`. |
| Incremental filter | YES. `sortBy:"updated"` (+ `ascending`), grammar `updated:<date>` / `updated:day-N` (needs `clientTimeZone`). Each note carries `version`, `updateSequenceNumber`, `updated`. |
| Delete detection | YES. `query:"intrash:true"` lists trashed notes (73 here); a note purged from trash disappears from enumeration, so a full-enumeration diff catches it. |
| Attachment bytes | YES. `get_note.structuredContent.resources[] = {id, hash (md5), mime, name, sizeBytes}`; `get_attachment(noteId, hash)` -> `{downloadUrl, expiresAt, mimeType, filename, sizeBytes, ...}`; the URL is a short-lived pre-signed `storage.googleapis.com` link, no auth header. Downloaded 226,075 B `image/png`, size and MD5 both match. |
| Refresh token | YES. Token response has `refresh_token`; access token `expires_in` 3600; the refresh grant works and ROTATES the refresh token (store the new one every time). |

Other facts:
- DCR works without approval; public client (`token_endpoint_auth_method: none`), PKCE S256, `resource=https://mcp.evernote.com`.
- `get_note` body is ENML in `structuredContent.content` (`en-note`, `div`, `br`, `en-media hash=...`); the text block in `content[]` is a summary only. Note links come as `evernote:///view/...` (per tool docs; none in the sampled note).
- `search_notes` with `resource:image/*` filters notes by attachment type.
- No rate-limit headers were seen in 80+ calls; slowest call 2.5 s. Limits are unpublished: the provider must back off on 429.
- `tools/list` also advertises WRITE tools (create/edit/delete) under a `read` grant. The product must call read tools only, pinned by a test against an allow-list.
- Open: Evernote's terms on unattended/scheduled use of the MCP beta. Owner to confirm (support email draft in the Plan E doc) before the flag goes on for members.
- Free-plan members cannot use it (Evernote rule); the tile must say so and offer .enex import.
