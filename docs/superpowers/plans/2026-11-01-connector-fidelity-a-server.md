# Connector fidelity — Plan A (server connector path + shared link/media pieces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Links, images and files that members bring in through the server connectors (Notion, Obsidian-server, Roam, Craft, OneNote, Dropbox) arrive working: every link that pointed somewhere still points there and opens, internal links are real note links, every image renders from UCT storage, every file is kept, and nothing is dropped without a visible marker.

**Architecture:** Three layers, each with one owner. (1) **Converters** (`note_connectors/convert/**`, `providers/*.py`) emit placeholder docs with the right link keys and media refs. (2) **One engine chokepoint** (`engine.py`) finalizes every doc (linkify, scheme normalization), runs every media item through **one media policy** (`journal_two/media_policy.py`), and replaces anything that could not come over with an `importNotice` block. (3) **Bookkeeping** stays timestamp-neutral: media retry state lives in the note body (`importNotice.attempts`) and the `import_media_pending` flag, link healing is a cheap DB-only pass keyed by a new `import_links_pending` flag, and "did the remote change" is keyed on the remote's own revision, so a converter fix never manufactures a conflict copy.

**Tech Stack:** Python 3.12 / FastAPI / SQLite (`auth.db`), Pillow (+ `pi-heif` for HEIC), `linkify-it-py`, markdown-it-py; React + TipTap 3 (client node + link click extension); pytest, vitest.

**Spec:** `docs/superpowers/specs/2026-11-01-connector-fidelity-and-evernote-design.md` (read ALL of it, including §15). Hotfix G1 (edited + remote unchanged ⇒ skip) from PR #614, branch `fix/note-sync-never-overwrites-edits`, is assumed merged; line references to `engine.py` below are to that branch's file.

Sibling plans written in parallel against the same interfaces: **B** (client file importer, `app/src/pages/journal-2-0/lib/importer/**`, Evernote .enex), **C** (Obsidian plugin attachments), **D** (Sync now, leftovers, repair). Plan A owns the interfaces in "Shared interfaces" below; B/C/D consume them.

## Global Constraints

- Master is production (Railway deploys `production`). Ship each task as its own PR; standing GO to deploy when ready, report member impact after. The owner merges where the classifier blocks `gh pr merge`.
- New Python deps change `requirements.txt` ⇒ flow-worker watched ⇒ the ship needs the owner-only `UCT_FLOW_OVERRIDE` step, outside 9:30–16:00 ET. Only **Task 7** changes `requirements.txt`.
- Engine bookkeeping writes must stay timestamp-neutral (never bump `updated_at`), the way `engine.py` `_write_*_preserving_updated_at` and `_apply_resolved_body` already are.
- Never rewrite a note the member has edited since import (`updated_at > imported_at`), except the existing conflict-sibling policy, which is unchanged.
- Any path that drops member content must leave a visible marker in the note (an `importNotice` block). No silent drops.
- A hotlinked image is never kept as a hotlink: download and rehost. `http://` is allowed for the DOWNLOAD only, through the SSRF guard on every redirect hop; what we serve is always our own URL.
- Unsafe link schemes (`javascript:`, `data:`, `vbscript:`, `file:`) stay text. App deep links (`evernote:`, `notion:`, `obsidian:`, `onenote:`) resolve to the imported note when possible, else text. Relative and `#fragment` links never resolve against uctintelligence.com.
- One guard per invariant, mutation-proved. No rail may normalize away the difference it is checking (the reason Task 3 rewrites the Obsidian parity rails).
- Node type tables are ONE FACT IN TWO FILES: a new node type gets a row in `api/services/journal_two/notebook_schema.py` AND `app/src/pages/journal-2-0/lib/notebookSchema.js` (pinned by `tests/test_notebook_schema_guard.py`), and a row in every per-type table listed in Task 5. Never remove a row.
- Heavy work never on the prod pod's request path: the backfill in Task 2 is a batched, flag-file one-shot in a background thread; nothing here runs a whole-volume scan per request.
- Notebook first-open byte budget and existing rails (key-listener census, persistence census, TERM-033/063/066 ratchets) stay green; the new client node is small and has no new dependency.
- `notes.py::import_confirm` is shared with Plan B Task 10 (kwargs `guard_edits`, `mode="recover"`, buckets `recovered`/`keptEdited`, and `update_note` stamping `imported_at` when a PUT carries `importMediaPending`). Plan A never changes those; its own `import_confirm` edits (Task 1 `import_remote_rev`, Task 4 `import_links_pending`, Task 6 pending tri-state + skip gate) are additive lines inside the existing UPDATE/INSERT and the skip condition. Whichever plan lands second rebases; neither rewrites the other's lines.
- Test commands: Python `python -m pytest <path> -q -p no:cacheprovider` from the checkout root; client `cd app && npx vitest run <path>`. A `vitest -t` filter that matches nothing exits 0: always run by file path.

## Shared interfaces (owned here, consumed by Plans B/C/D)

Binding names agreed with the controller (Plan B asks A1-A6, Plan D's `failures_json`) are marked **[B]** / **[D]**.

1. **`api/services/journal_two/media_policy.py`** (Task 8):
   - `@dataclass(frozen=True) class MediaResult: kind: Literal["image","file"]; mime: str; data: bytes; filename: str; original: "MediaResult | None" = None`
   - `class MediaRejected(Exception): reason: str; marker_text: str` — `reason in {"too_large","storage_limit","unsupported","fetch_failed","unsafe"}`; constructor `MediaRejected(reason: str, marker_text: str)`.
   - `def normalize_media(data: bytes, declared_mime: str | None, filename: str | None) -> MediaResult`
   - `def member_media_bytes(user_id: str) -> int`
   - `MEMBER_IMPORT_MEDIA_CAP_BYTES: int` = `int(os.environ.get("NOTE_IMPORT_MEDIA_CAP_BYTES", 2 * 1024**3))`, read as a module global at call time (tests monkeypatch it).
   - **[B A1] The existing upload doors run the policy** (Task 8): `POST /api/j2/notes/{noteId}/images` and `POST /api/j2/notes/{noteId}/attachments` accept raw bytes under the declared MIME (parameters stripped) and run `normalize_media` then `store_media`. 200 ⇒ `{url, kind: "image"|"file", name, size, mime, width, height, original: {url, name} | null}` (`kind`/`name`/`original` are additive to today's `{url,width,height}` / `{url,name,size}`). Refusal ⇒ 400 `{"detail": <marker text>, "reason": <MediaRejected reason>}`; a legacy `NoteValidationError` stays `{"detail": str}` with no `reason`. The hero door (`/hero`) is unchanged.
   - **[B A2] Hotlink fetch door** (Task 9): `POST /api/j2/notes/media/fetch`, body `{url: string, noteImportKey?: string}`. The server resolves `noteImportKey` to the member's own non-trashed note id (media storage is per note); absent or unknown ⇒ 404 `{"detail": "Not found"}`. Fetch through `guarded_media_get(..., allow_http=True)` (SSRF guard on every redirect hop, http allowed for the download only), then `normalize_media` + `store_media`. 200 ⇒ `{src, kind: "image"|"file", filename}`; refusal ⇒ 422 `{"reason": <reason>, "markerText": <str>}` (top level, not inside `detail`). Rate-limited per member (Limiter scope `notebook-media-fetch`, 120/minute).
2. **TipTap node `importNotice`** (Task 5): block atom, attrs `{reason: str, name: str | None, sourceUrl: str | None, ref: str | None, attempts: int}`. The visible text is DERIVED from attrs by `import_notice.marker_text` (server) and `importNoticeText` (client), one copy table pinned in both files. `sourceUrl` renders as a clickable link only when it is http(s). **[B A3]** The reason set is the union of the server reasons and Plan B's client reasons: `too_large, storage_limit, unsupported, fetch_failed, unsafe, upload_failed, type_refused, unresolvable_src, decode_failed, missing_resource`. Plan B writes the node as JSON only; an unknown reason renders the `unsupported` sentence (never blank, never a crash).
3. **Internal note link href** stays `/journal?j2tab=notebook&note=<id>`. Task 2 makes it open in-app and count in `j2_note_links`. **[B A5]** Unresolved internal links stay stored as link marks whose href is `import-link://<key>` and render as PLAIN TEXT (no link styling, nothing opens, no hover hint) until healed. One exception, required by spec N-5 ("unresolvable ⇒ keep a working notion.so URL"): `import-link://notion:<uuid>` opens `https://www.notion.so/<uuid-without-dashes>` by the normal open gestures.
4. **Link keys** (Task 4, `note_connectors/link_keys.py`): `resolve_link_keys(conn, user_id: str, keys: Iterable[str]) -> dict[str, str]` (key → note id). Key kinds: an exact `import_key` (today's form); `name:obsidian:<vault_id>/<target as written, lowercased>` (Task 13); **[B A5]** `evernote-title:<title>` — healed against the single non-trashed Evernote-imported note (`import_source = 'evernote'`, the value Plan B's commit writes; verify against Plan B's `commit.js` before merging) of this member whose title equals `<title>` after trim + whitespace-collapse on both sides; 2+ matches stay unresolved.
   - **[B A6] Heal door**: `POST /api/j2/notes/import/heal-links`, body `{noteIds: string[]}` (max 500) ⇒ `{healed: number, unresolved: [{noteId, key, text}]}`. Same heal as the connector final link pass, member-scoped, timestamp-neutral.
5. **Server linkify** (Task 10): `api/services/journal_two/note_connectors/convert/linkify.py` `linkify_doc(doc: dict) -> dict` (pure, never mutates input, never inside `code` marks, `codeBlock`, or existing `link` marks). **[B]** Same rule as Plan B's client linkify: `linkify-it-py` matches, but only `http://`/`https://` URLs, `www.` hosts and emails/`mailto:` are kept, so a fuzzy bare domain (`NVDA.US`, `example.com`) never becomes a link.
6. **Media retry bookkeeping** is timestamp-neutral: `importNotice.attempts` in the body, written only through `_apply_resolved_body`'s optimistic-locked, `updated_at`-preserving UPDATE; `import_media_pending` becomes tri-state 0 / 1 (retry now) / 2 (waiting for storage space).
7. **For Plan C:** a provider's `fetch_media` that raises `NoteConnTransient` ⇒ retryable `fetch_failed` notice; raises `NoteConnUnsupported` ⇒ final notice (`unsupported`, or `unsafe` when the SSRF guard refused). Plan C changes Obsidian's `fetch_media` to serve staged attachments; until then local vault attachments get the final `unsupported` notice (Task 6).
8. **[D] Sync-log failures:** Plan D owns the DDL for `j2_note_sync_log.failures_json TEXT` (all three places in `db.py`). Plan A only WRITES it, in `_finish_log`: a JSON array of `{"noteTitle": str, "reason": str, "name": str | null}` where `reason` is the member-readable sentence (`import_notice.marker_text`, e.g. "Couldn't copy chart.png — retrying on the next sync"); NULL when there are none. The sync result keeps returning `failures` exactly as today. Plan A adds no ALTER for it.

## Review Focus

1. **The first nightly full pass after any converter change re-hashes every note.** A member-edited note must not get a "(synced copy)" sibling, and an unedited note must update in place. Pinned in Task 1 (`test_converter_change_never_manufactures_a_conflict_copy`).
2. **Phone photos with EXIF rotation** (HEIC from an iPhone, rotated JPEG) must not land sideways after conversion or downscale. Pinned in Task 8 (`test_conversion_applies_exif_orientation`).
3. **URLs at the edges of text**: trailing `.`/`,`/`)`, a URL inside inline code or a code block, a URL that is already a link. Pinned in Task 10 (`test_linkify_edge_punctuation_and_code`).
4. **A big import that hits the 2 GB cap midway**: the note still imports, items past the cap get "storage limit" notices, the pass is not a failure, and they come back once space frees. Pinned in Task 8 (`test_cap_reached_mid_note_imports_the_note_and_marks_the_rest`).
5. **Hostile or broken media**: a decompression-bomb TIFF, a `.png` that is really an HTML page, a redirect to `169.254.169.254`. Each must be a named notice, never a 500, never a stored HTML page. Pinned in Task 8 (`test_bomb_and_disguised_html_are_rejected_not_stored`) and Task 9 (`test_redirect_to_private_address_is_unsafe_notice`).

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `api/services/journal_two/note_connectors/engine.py` | conflict gate, finalize pass, media pass, link passes | 1, 4, 6, 8, 9, 10 |
| `api/services/journal_two/notes.py` | `import_confirm` bookkeeping, pending state, link projection, attachment save/serve | 1, 2, 4, 6, 8 |
| `api/services/journal_two/db.py` | new columns (`import_remote_rev`, `import_links_pending`); NOT `failures_json` (Plan D) | 1, 4 |
| `api/services/journal_two/import_notice.py` (new) | notice copy, node builder, pending-state, attempts | 5, 6 |
| `api/services/journal_two/media_policy.py` (new) | sniff, convert, downscale, classify, cap, store | 8 |
| `api/services/journal_two/note_connectors/link_keys.py` (new) | resolve link keys, heal pending links | 4, 13 |
| `api/services/journal_two/note_connectors/convert/linkify.py` (new) | linkify + scheme normalization of a finished doc | 10 |
| `api/services/journal_two/note_connectors/convert/rewrite.py` | resolved media + notices in place of drops | 6, 8 |
| `api/services/journal_two/note_connectors/convert/mddoc.py` | decode-once destinations, data: images, href hook | 3, 9, 13 |
| `api/services/journal_two/note_connectors/convert/notion_blocks.py` | mentions, workspace links, tables, embeds, titles | 11, 12 |
| `api/services/journal_two/note_connectors/convert/web_embed.py` (new) | server port of `lib/webEmbeds.js::embedFor` | 12 |
| `api/services/journal_two/note_connectors/providers/notion.py` | guarded media fetch, title lookup | 9, 12 |
| `api/services/journal_two/note_connectors/providers/base.py` | `allow_http` on the SSRF guard | 9 |
| `api/services/journal_two/note_connectors/providers/obsidian.py` | escaped pipe, pending name links, relative md links, polish | 3, 13 |
| `api/routers/journal_two.py` | `/images` + `/attachments` run the policy, `media/fetch` route, `heal-links` route, download-only serving | 4, 8, 9 |
| `app/src/pages/journal-2-0/lib/linkClickOpen.js` (+ test) | internal + pending links open | 2 |
| `app/src/pages/journal-2-0/lib/importNoticeNode.js`, `importNoticeText.js` (new) | the client node + copy | 5 |
| `app/src/pages/journal-2-0/lib/tiptap.js`, `notebookSchema.js` | register node, schema level 5 | 5 |
| `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx` | `uct:open-note` listener | 2 |
| `api/services/journal_two/note_connectors/convert/obsidian_parity_fixtures_gen.py`, `app/.../importer/obsidianParity.contract.test.js` | parity rails compare raw hrefs | 3 |
| `api/services/journal_two/note_connectors/corpora/**` (new) | messy Notion/Obsidian corpora + generator + rails | 14 |

---

### Task 1: "Did the remote change" is keyed on the remote's revision, not on our conversion

Why first: every later task changes converter output. `_import_payload_hash` covers the converted `bodyJson`, so on the next nightly full pass every member-edited note whose conversion changed would read as "edited AND remote changed" and get a "(synced copy)" sibling (engine.py `is_genuine_conflict`, ~1507).

**Files:**
- Modify: `api/services/journal_two/db.py` (fresh `CREATE TABLE j2_notes` + `_PHASE_2_ALTERS`)
- Modify: `api/services/journal_two/notes.py` `import_confirm` (~1356-1530)
- Modify: `api/services/journal_two/note_connectors/engine.py` `_bulk_existing_note_meta` (~949), `_write_import_hash_preserving_updated_at` (~794), `_import_remote_notes` (~1483-1545)
- Test: `api/services/journal_two/test_note_connectors_engine.py`

**Interfaces:**
- Produces: column `j2_notes.import_remote_rev TEXT` (NULL for legacy rows) = the `updatedAt` string of the import entry last confirmed or baselined.
- Produces: `_remote_changed(meta: dict, rn: RemoteNote, entry_hash: str) -> bool` in engine.py.
- Produces: `_write_import_hash_preserving_updated_at(conn, user_id, note_id, import_hash, *, remote_rev: str | None)` (new keyword).

- [ ] **Step 1: Write the failing tests** (reuse fixtures `db, provider, source, _rn, _body`)

```python
async def test_converter_change_never_manufactures_a_conflict_copy(source, provider, monkeypatch):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Page")}
    await engine.sync_source(source["id"], full=True)
    n = notes_svc.list_notes("u1")[0]
    notes_svc.update_note("u1", n["id"], {"title": "Mine"})
    # same remote revision, different conversion (a converter fix shipped)
    provider.notes_by_id = {"p1": _rn("p1", "Page", text="Page, converted better")}
    r = await engine.sync_source(source["id"], full=True, manual=True)
    assert r["conflicts"] == 0
    assert [x["title"] for x in notes_svc.list_notes("u1")] == ["Mine"]

async def test_converter_change_updates_an_unedited_note_in_place(source, provider):
    ...  # same setup without the member edit
    assert r["updated"] == 1 and "converted better" in notes_svc.list_notes("u1")[0]["bodyPlain"]

async def test_remote_revision_change_on_edited_note_still_conflicts(source, provider):
    ...  # member edit, then updated_at="2026-08-02T00:00:00+00:00" with new text
    assert r["conflicts"] == 1
    assert sorted(x["title"] for x in notes_svc.list_notes("u1")) == ["Mine", "Page (synced copy)"]

async def test_legacy_row_without_remote_rev_uses_imported_at_fallback(source, provider):
    ...  # import, then UPDATE j2_notes SET import_remote_rev = NULL, member edit,
    # converter change with the SAME remote updated_at -> conflicts == 0;
    # then a remote updated_at later than imported_at -> conflicts == 1
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest api/services/journal_two/test_note_connectors_engine.py -q -p no:cacheprovider -k "converter_change or remote_revision or legacy_row"`
Expected: `test_converter_change_never_manufactures_a_conflict_copy` and the legacy test FAIL (`conflicts == 1`); the other two pass already (they are controls).

- [ ] **Step 3: Add the column.** `"ALTER TABLE j2_notes ADD COLUMN import_remote_rev TEXT"` in `_PHASE_2_ALTERS`, and the column on the fresh `CREATE TABLE`.

- [ ] **Step 4: Write it.** `import_confirm` sets `import_remote_rev = n.get("updatedAt") or None` on both the UPDATE and INSERT. `_write_import_hash_preserving_updated_at` also writes `remote_rev` when given (same `updated_at`-preserving idiom). `_bulk_existing_note_meta` selects it as `meta["importRemoteRev"]`.

- [ ] **Step 5: Implement `_remote_changed`** and use it for `is_genuine_conflict = meta is not None and _is_conflict(meta) and _remote_changed(meta, rn, notes_svc._import_payload_hash(entry))`. Rule, in order: hash equal ⇒ False; `meta["importRemoteRev"]` not None and `rn.updated_at` not None ⇒ `rn.updated_at != meta["importRemoteRev"]`; `rn.updated_at` is None ⇒ True (today's hash rule); else (legacy NULL) ⇒ `_parse_iso(rn.updated_at) > _parse_iso(meta["importedAt"])`. The genuine-conflict branch passes `remote_rev=rn.updated_at` to the baseline write.

- [ ] **Step 6: Run the engine suite**

Run: `python -m pytest api/services/journal_two/test_note_connectors_engine.py -q -p no:cacheprovider`
Expected: all PASS, including the existing `test_conflicted_note_with_*` tests.

- [ ] **Step 7: Mutation-prove.** Replace the `importRemoteRev` comparison with `True`; the first test must go red. Restore by re-editing the line (never `git checkout`).

- [ ] **Step 8: Commit** `fix(note-sync): a converter change never reads as a remote edit (remote revision gate)`

---

### Task 2: Internal links open in-app and count as note links (L-1, L-2)

**Files:**
- Modify: `app/src/pages/journal-2-0/lib/linkClickOpen.js` and `linkClickOpen.test.js`
- Modify: `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx` (listener)
- Modify: `app/src/pages/journal-2-0/lib/noteContent.css` (pending-link style)
- Modify: `api/services/journal_two/notes.py` `_sync_note_sidecars` walk (~490-625)
- Create: one-shot backfill `run_internal_link_projection_backfill(conn)` in `api/services/journal_two/db.py`, flag file `.note_links_internal_href_v1` in `DATA_DIR`, started from the same boot hook as the other notebook one-shots, background thread, batches of 500
- Test: `app/src/pages/journal-2-0/lib/linkClickOpen.test.js`, `api/services/journal_two/test_note_links_internal_href.py` (new), `tests/test_public_note_payload.py`

**Interfaces:**
- Produces (JS, exported from `linkClickOpen.js`): `internalNoteIdFromHref(href: string) -> string | null` (accepts exactly `/journal?j2tab=notebook&note=<id>`, `<id>` matching `[A-Za-z0-9_-]+`, params in any order); `pendingLinkFallbackHref(href: string) -> string | null` (`import-link://notion:<uuid>` ⇒ `https://www.notion.so/<32 hex>`, any other `import-link://` ⇒ null). Per [B A5], any other `import-link://` renders and behaves as plain text.
- Produces (DOM event): `CustomEvent('uct:open-note', {bubbles: true, cancelable: true, detail: {noteId, originalEvent}})` dispatched on `view.dom`. A host that handles it calls `preventDefault()`. Unhandled ⇒ fallback `history.pushState(null, '', href)` + `dispatchEvent(new PopStateEvent('popstate'))`.
- Produces (Python, notes.py): `_internal_note_id(href: str) -> str | None`, same accepted shape as the JS helper.

- [ ] **Step 1: Write the failing client tests.** Replace the `'/journal/notebook/note/n1'` refusal row with explicit cases:

```js
it('a resolved internal link opens in-app on Ctrl+click, same tab', () => {
  const ed = mount([linkPara('Other note', '/journal?j2tab=notebook&note=n123')])
  const seen = vi.fn((e) => e.preventDefault())
  ed.view.dom.addEventListener('uct:open-note', seen)
  ctrlClick(linkEl(ed))
  expect(seen.mock.calls[0][0].detail.noteId).toBe('n123')
  expect(openSpy).not.toHaveBeenCalled()
})
it('unhandled internal open falls back to history + popstate', ...)   // pushState spy called with the href
it('read-only view: a plain click opens an internal link in-app', ...)
it('touch re-tap opens an internal link in-app', ...)
it('a plain click in an editable editor still never opens', ...)
it.each(['/journal?j2tab=notebook&note=', '/journal?j2tab=notebook&note=a b', '/journal/x?note=n1',
         'javascript:alert(1)'])('%j is not an internal note link', (h) =>
  expect(internalNoteIdFromHref(h)).toBeNull())
it('import-link://notion:<uuid> opens notion.so in a new tab on Ctrl+click', () => {
  // href import-link://notion:1a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6
  expect(openSpy).toHaveBeenCalledWith('https://www.notion.so/1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6', '_blank', 'noopener,noreferrer')
})
it('any other import-link:// never opens and gets no hover hint (plain text)', ...) // a.title === '' ; window.open not called
it('an import-link:// anchor is styled as plain text', ...) // getComputedStyle-free check: the noteContent.css rule exists for a[href^="import-link://"]:not([href^="import-link://notion:"])
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/linkClickOpen.test.js`
Expected: FAIL (`internalNoteIdFromHref` is not exported; no event dispatched).

- [ ] **Step 3: Implement.** In `click`, before `openableLinkHref`: `const noteId = internalNoteIdFromHref(href)`; when the gesture would open (read-only plain click, Ctrl/Cmd+click, touch re-tap) and `noteId`, dispatch `uct:open-note`, fall back as above, `preventDefault`, return true. `pendingLinkFallbackHref` is tried after `openableLinkHref` and opens in a new tab like an external link. Hover: an internal link and a Notion pending link get `linkOpenHint()`; any other `import-link://` gets nothing. Update the header comment's "only http(s) and mailto" paragraph to name the two new doors. `NoteEditorPage.jsx` adds one listener on the editor DOM that calls `useNoteNavigation()(noteId, detail.originalEvent)` and `preventDefault()` (so split view and the side pane behave exactly like a `noteLink` chip). `noteContent.css`: `a[href^="import-link://"]:not([href^="import-link://notion:"]) { color: inherit; text-decoration: none; cursor: text; }` (plain text, [B A5]).

- [ ] **Step 4: Run client tests** — same command; expected PASS. Also run `npx vitest run src/pages/journal-2-0/components/notebook/NoteEditorPage.noteLinks.test.jsx` (unchanged behaviour).

- [ ] **Step 5: Write the failing server tests** (`test_note_links_internal_href.py`, using the notes-service fixture pattern in `api/services/journal_two/test_notes*.py`)

```python
def test_internal_href_link_mark_is_projected_as_a_note_link(): ...
    # body: paragraph with text "my alias" marked link href=/journal?j2tab=notebook&note=<B>
    # -> get_note_backlinks(user, B) lists A once; get_note_graph has edge A->B
def test_a_link_split_across_bold_runs_counts_once(): ...   # two adjacent text nodes, same href -> 1 row
def test_display_text_is_untouched_by_projection(): ...     # stored body still says "my alias"
def test_external_and_malformed_hrefs_are_not_projected(): ...  # https://..., /journal?note=, note=a b
def test_backfill_projects_existing_bodies_once(): ...      # row written by raw SQL, run backfill twice -> 1 row, flag file exists
```
And in `tests/test_public_note_payload.py`: `test_internal_note_href_mark_renders_as_text_on_share_and_publish` (mark removed, text kept, no note id in the payload).

- [ ] **Step 6: Run to verify they fail** — `python -m pytest api/services/journal_two/test_note_links_internal_href.py tests/test_public_note_payload.py -q -p no:cacheprovider -k "internal"`. Expected: projection tests FAIL; the public-payload test may already pass (it is the L-1 "never leak a private id" pin; keep it either way).

- [ ] **Step 7: Implement.** In the `_sync_note_sidecars` walk, for a `text` node whose marks include `link` with `_internal_note_id(href)`, append the id to `link_ids` unless the previous sibling text node carried the same href. Backfill: `SELECT id, user_id, body_json, body_plain FROM j2_notes WHERE deleted_at IS NULL AND body_json LIKE '%j2tab=notebook&note=%'` in id-ordered pages of 500, re-running `_sync_note_sidecars` per row and committing per page; touches no `updated_at`.

- [ ] **Step 8: Run** both suites above plus `python -m pytest api/services/journal_two -q -p no:cacheprovider -k "backlink or graph"`. Expected: PASS.

- [ ] **Step 9: Commit** `feat(notebook): imported internal links open in-app and count as note links`

---

### Task 3: Obsidian links with spaces and escaped pipes resolve (O-1, O-8) + honest parity rails

**Files:**
- Modify: `api/services/journal_two/note_connectors/convert/mddoc.py` (`_inline_nodes` link_open ~628, `_image_node` ~477, `_html_inline_walk` ~905, `_html_image_node` ~826)
- Modify: `api/services/journal_two/note_connectors/providers/obsidian.py` `_transform_wiki_and_embeds` (~353)
- Modify: `api/services/journal_two/note_connectors/convert/obsidian_parity_fixtures_gen.py:109-131`, `app/src/pages/journal-2-0/lib/importer/obsidianParity.contract.test.js:97-117`; regenerate `app/.../importer/__fixtures__/obsidian_parity/*.json`
- Create: `convert/obsidian_fixtures_in/09-space-and-pipe.md` + `.vault.json`
- Test: `api/services/journal_two/test_obsidian_provider.py`, `api/services/journal_two/test_obsidian_parity_fixtures.py`, `api/services/journal_two/note_connectors/convert/test_note_convert_mddoc.py` (find with Glob `**/test_note_convert_mddoc.py`)

**Interfaces:**
- Produces: `mddoc._destination_as_written(dest: str) -> str` — the ONE place a markdown-it-normalized destination is decoded: `urllib.parse.unquote(dest)` for an `import-link://` href or a scheme-less image src; any other destination is returned unchanged.

- [ ] **Step 1: Fix the rails first (they must go red).** Delete the `urllib.parse.unquote` in `_normalize_link_href` / `_normalize_image_src` and rewrite its docstring to say the rail compares the stored hrefs byte-for-byte. The JS half (`decodeURIComponent` in `normalizeLinkHref` / `normalizeImageSrc`) is Plan B's edit: if Plan B has landed, the JS rail is already red on every `%20` fixture and this task's Step 5 regeneration is what turns it green; if it has not, make the same deletion here and tell Plan B it is done. Add fixture `09-space-and-pipe.md` with `[[Target Note]]`, `[[Target Note|alias]]`, `| [[Other note\|alias]] |` in a table, `![[My Img.png]]`, vault paths `Notes/Target Note.md`, `Other note.md`, `attachments/My Img.png`.

- [ ] **Step 2: Write the failing provider tests**

```python
def test_wikilink_to_a_name_with_spaces_resolves_to_the_import_key():
    links = _convert("[[Target Note]]", paths=["Notes/Target Note.md"])["links"]
    assert links == ["obsidian:v1/Notes/Target Note.md"]
def test_aliased_link_with_spaces_keeps_the_alias_text(): ...       # text "alias", href import-link://obsidian:v1/Notes/Target Note.md
def test_escaped_pipe_in_a_table_cell_resolves(): ...               # "| [[Other note\\|alias]] |" -> cell text "alias", link resolves
def test_embedded_image_with_space_registers_the_raw_vault_path(): ...  # media ref == "attachments/My Img.png"
def test_a_literal_percent_twenty_in_a_name_survives():  ...        # paths=["100%20club.md"], [[100%20club]] resolves to that key
```
And in the mddoc tests: `test_link_destination_decoded_once_only_for_internal_and_relative` (`[x](https://a.com/a%20b)` keeps `%20`; `[x](<import-link://k/a b>)` yields `import-link://k/a b`).

- [ ] **Step 3: Run to verify red** — `python -m pytest api/services/journal_two/test_obsidian_provider.py api/services/journal_two/test_obsidian_parity_fixtures.py -q -p no:cacheprovider` and `cd app && npx vitest run src/pages/journal-2-0/lib/importer/obsidianParity.contract.test.js`. Expected: the new tests FAIL with `%20` keys; the parity rail FAILS on every fixture with a space in a name (this is the rail now telling the truth).

- [ ] **Step 4: Implement.** Route every LINK_PREFIX href and every scheme-less image src through `_destination_as_written` at the four mddoc sites (link_open, image token, HTML `<a>`, HTML `<img>`), before `ctx.links.append` / `_register_media`. In obsidian.py `repl`, strip one trailing backslash from `raw_target` (`raw_target[:-1].rstrip() if raw_target.endswith("\\") else raw_target`).

- [ ] **Step 5: Regenerate the server parity fixtures** (required by Plan B: its JS rail stays red until this runs) — `python -m api.services.journal_two.note_connectors.convert.obsidian_parity_fixtures_gen`, commit every changed `__fixtures__/obsidian_parity/*.json` in this task's PR. If the client lane disagrees on fixture 09 (e.g. the escaped pipe), do NOT normalize: record the client-side difference as a named `knownClientGap` entry in the JS rail that points at Plan B's task, so the rail stays strict for everything else.

- [ ] **Step 6: Run** the three commands from Step 3. Expected: PASS (or exactly the named client gap).

- [ ] **Step 7: Mutation-prove** — remove the `unquote` from `_destination_as_written`; the provider test and the parity rail both go red.

- [ ] **Step 8: Commit** `fix(obsidian): links to notes with spaces and escaped pipes resolve; parity rails compare raw hrefs`

---

### Task 4: Pending means "something can still resolve" + a link heal pass (§5.1)

**Files:**
- Modify: `api/services/journal_two/db.py` (column `import_links_pending INTEGER`, fresh CREATE + `_PHASE_2_ALTERS`; index `CREATE INDEX IF NOT EXISTS idx_j2_notes_links_pending ON j2_notes(user_id, import_links_pending)`)
- Modify: `api/services/journal_two/notes.py` `_body_has_import_placeholder` (~1281), `import_confirm`
- Modify: `api/services/journal_two/note_connectors/engine.py` `_apply_resolved_body` (~988), `_find_stranded_placeholder_ids` (~1033), `_resolve_links_final_pass` (~1232), `_import_remote_notes` tail
- Create: `api/services/journal_two/note_connectors/link_keys.py`
- Modify: `api/routers/journal_two.py` (heal route next to `/notes/import/confirm`, ~3275)
- Test: `api/services/journal_two/test_note_connectors_engine.py`, `api/services/journal_two/test_note_link_keys.py` (new)

**Interfaces:**
- Consumes: Task 1's conflict gate (unchanged).
- Produces (`link_keys.py`):
  - `def resolve_link_keys(conn: sqlite3.Connection, user_id: str, keys: Iterable[str]) -> dict[str, str]` — exact keys via `notes_svc.import_check`; `evernote-title:<title>` ([B A5]) via the member's non-trashed `import_source = 'evernote'` notes compared on `_norm_title(t) = " ".join(t.split())`, kept only when exactly one note matches; unknown kinds resolve to nothing. (`name:obsidian:` is added in Task 13.)
  - `def heal_pending_links(user_id: str, *, note_ids: list[str] | None = None, conn: sqlite3.Connection | None = None, limit: int = 500) -> dict` ⇒ `{"healed": int, "checked": int, "unresolved": [{"noteId", "key", "text"}]}`. Candidates: `note_ids` when given (member-scoped: `user_id = ?`), else `import_links_pending = 1`; always `deleted_at IS NULL`. Skips notes with `updated_at > imported_at` (their links are listed in `unresolved`). Rewrites with `rewrite_body(doc, {}, id_by_key, strip_unresolved_links=False)`, writes through `engine._apply_resolved_body` semantics (optimistic lock, no `updated_at` bump). `unresolved[].text` is the marked run's display text.
- Produces (notes.py): `import_links_pending` = 1 iff the stored body contains `import-link://`; `_body_has_import_placeholder` now answers MEDIA only (`import-ref://`).
- Produces (route, [B A6]): `POST /api/j2/notes/import/heal-links` (auth = `get_current_user`), body `{noteIds: string[]}` (≤ 500, else 400) ⇒ `{"healed", "unresolved"}` from `heal_pending_links(user["id"], note_ids=noteIds)`.

- [ ] **Step 1: Write the failing tests** (the repro `scratchpad/notion/test_stranded_link.py` is the shape to copy)

```python
async def test_unresolvable_link_does_not_reimport_or_redownload(source, provider):
    # p1 links to "fake:fake-graph/UNSHARED" and carries one image
    r1 = await engine.sync_source(source["id"], full=True)
    calls = len(provider.fetch_media_calls)
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert (r2["updated"], r2["skipped"]) == (0, 1)
    assert len(provider.fetch_media_calls) == calls
    row = _row("u1", "fake:fake-graph/p1")
    assert (row["import_media_pending"], row["import_links_pending"]) == (0, 1)

async def test_link_heals_when_its_target_arrives_later_without_reimport(source, provider):
    # sync 1: p1 -> link to p2 (absent). sync 2 (incremental): only p2 is new.
    assert "/journal?j2tab=notebook&note=" + p2_id in json.dumps(_body(p1))
    assert _row(...)["import_links_pending"] == 0
    assert notes_svc.get_note("u1", p1_id)["updatedAt"] == before_updated_at

async def test_heal_never_touches_a_member_edited_note(source, provider): ...
async def test_heal_is_bounded_by_limit(): ...   # 3 pending notes, limit=2 -> checked == 2
def test_evernote_title_key_resolves_only_a_unique_match(): ...
    # two evernote notes titled "Plan" -> unresolved; one titled "  Plan   B " matches key "evernote-title:Plan B";
    # a trashed one and a non-evernote one never match
def test_heal_links_route_heals_named_notes_and_lists_the_rest(client):
    # POST {"noteIds": [a, b]} -> {"healed": 1, "unresolved": [{"noteId": b, "key": "evernote-title:Gone", "text": "Gone"}]}
def test_heal_links_route_is_member_scoped(client): ...  # another member's id -> healed 0, unresolved []
```

- [ ] **Step 2: Run to verify they fail** — `python -m pytest api/services/journal_two/test_note_connectors_engine.py api/services/journal_two/test_note_link_keys.py -q -p no:cacheprovider -k "unresolvable or heal or title_key"`. Expected: FAIL (r2 reports `updated == 1`; module `link_keys` missing).

- [ ] **Step 3: Implement the split.** `import_confirm` and `_apply_resolved_body` both compute `import_media_pending` from `_body_has_import_placeholder` (media only, for now) and `import_links_pending` from the `import-link://` substring. `_find_stranded_placeholder_ids` matches `import-ref://` only. `_resolve_links_final_pass` uses `resolve_link_keys` instead of `import_check` directly. Call `heal_pending_links(user_id, conn=conn)` at the end of `_import_remote_notes` inside its own try/except that appends a named failure (never fails the sync).

- [ ] **Step 4: Run** the suite: `python -m pytest api/services/journal_two/test_note_connectors_engine.py api/services/journal_two/test_note_link_keys.py api/services/journal_two/test_obsidian_ingest.py -q -p no:cacheprovider`. Expected: PASS (existing `test_a_hand_stranded_note_heals_on_the_next_sync` must still pass: it strands an `import-ref://`).

- [ ] **Step 5: Mutation-prove** — put `import-link://` back into `_find_stranded_placeholder_ids`; `test_unresolvable_link_does_not_reimport_or_redownload` goes red.

- [ ] **Step 6: Commit** `fix(note-sync): an unreachable link no longer re-imports the note every pass; links heal when the target arrives`

---

### Task 5: The `importNotice` node (client render, schema, every per-type table, export)

Ships inert (nothing emits it yet). It must deploy before or with Task 6, because a client that lacks a node type opens a note holding it as empty (the schema guard refuses the write, but the member sees a blank note).

**Files:**
- Create: `api/services/journal_two/import_notice.py`
- Create: `app/src/pages/journal-2-0/lib/importNoticeNode.js`, `app/src/pages/journal-2-0/lib/importNoticeText.js`, `app/src/pages/journal-2-0/lib/importNoticeNode.test.js`
- Modify: `app/src/pages/journal-2-0/lib/tiptap.js` (register beside `LinkPreview, WebEmbed`), `lib/notebookSchema.js` (`importNotice: 5`), `lib/offline/refusedCopyDisplay.js` (row beside `webEmbed`), `lib/noteContent.css`
- Modify: `api/services/journal_two/notebook_schema.py` (`"importNotice": 5` with a `# ── 5: connector fidelity (2026-11) ──` header and the NEVER-REVERT note), `note_citation_text.py` (`_LEAF_TYPES`), `public_note_payload.py` (policy rows ~429 and ~466: drop in share, publish and gallery), `notes_export.py` (`tiptap_to_markdown` node branch), `notes_export_formats.py` (HTML/docx branch beside `linkPreview` ~1025)
- Test: `tests/test_notebook_schema_guard.py` (already parses both files), `tests/test_import_notice.py` (new), `tests/test_public_note_payload.py`, `tests/test_notes_export_formats.py`

**Interfaces:**
- Produces (`import_notice.py`):
  - `IMPORT_NOTICE_TYPE = "importNotice"`; `SERVER_REASONS = ("too_large", "storage_limit", "unsupported", "fetch_failed", "unsafe")`; `CLIENT_REASONS = ("upload_failed", "type_refused", "unresolvable_src", "decode_failed", "missing_resource")` ([B A3]); `NOTICE_REASONS = SERVER_REASONS + CLIENT_REASONS`; `MEDIA_RETRY_MAX_ATTEMPTS = 3`. An unknown reason reads as `unsupported`.
  - `def marker_text(reason: str, name: str | None, *, attempts: int = 0, source_url: str | None = None) -> str`
  - `def notice_node(reason: str, *, name: str | None, source_url: str | None, ref: str | None, attempts: int) -> dict` ⇒ `{"type": "importNotice", "attrs": {...}}` (attrs exactly the five interface names)
  - `def is_retryable(attrs: dict) -> bool` — `reason == "fetch_failed" and attempts < MEDIA_RETRY_MAX_ATTEMPTS`
  - `def notice_attempts_by_ref(body_json: Any) -> dict[str, int]`
  - `NOTICE_COPY: dict[str, str]` — the copy table (below), the single server authority
- Produces (JS): `importNoticeText(attrs) -> string` and `NOTICE_COPY` in `importNoticeText.js`; `ImportNotice` TipTap node in `importNoticeNode.js` (`group: 'block', atom: true, selectable: true`, `parseHTML: div[data-type="import-notice"]`, attrs default `null` except `attempts: 0`).

Copy (exact; `{name}` falls back to `this item`; the trailing " — open the original" is appended in the renderer, as a link, only when `sourceUrl` passes `safeLinkHref`):

| reason | text |
|---|---|
| `fetch_failed`, retryable | `Couldn't copy {name} — retrying on the next sync` |
| `fetch_failed`, final | `Couldn't copy {name}` |
| `too_large` | `{name} is too large to copy (limit 25 MB)` |
| `storage_limit` | `Not copied: storage limit. {name} will be copied once space frees up` |
| `unsupported` | `{name} can't be shown here` |
| `unsafe` | `{name} wasn't copied: its address isn't allowed` |
| `upload_failed` | `Couldn't upload {name}` |
| `type_refused` | `{name} is a file type that can't be stored here` |
| `unresolvable_src` | `Couldn't find the image file for {name}` |
| `decode_failed` | `{name} couldn't be read` |
| `missing_resource` | `{name} was missing from the export` |

- [ ] **Step 1: Write the failing tests**

```python
def test_notice_copy_is_one_fact_in_two_files():
    js = Path("app/src/pages/journal-2-0/lib/importNoticeText.js").read_text(encoding="utf-8")
    assert _parse_js_copy_table(js) == import_notice.NOTICE_COPY   # parse, never restate
def test_marker_text_retry_vs_final():
    assert marker_text("fetch_failed", "a.png", attempts=1).endswith("retrying on the next sync")
    assert marker_text("fetch_failed", "a.png", attempts=3) == "Couldn't copy a.png"
def test_notice_is_a_leaf_with_no_plain_text(): ...       # extract_plain_text of a doc with only a notice == ""
def test_notice_markdown_export(): ...                     # "> Couldn't copy a.png [open the original](<https://x/a.png>)"
def test_notice_is_dropped_from_share_publish_and_gallery(): ...
```
```js
it('renders the derived text and a safe sourceUrl link', ...)   // https -> <a target=_blank rel=noopener noreferrer>
it('never renders a javascript: sourceUrl as a link', ...)
it.each(['upload_failed', 'type_refused', 'unresolvable_src', 'decode_failed', 'missing_resource'])(
  'renders the client reason %s from node JSON alone', ...)
it('an unknown reason renders the unsupported sentence', ...)
it('round-trips through getJSON with all five attrs', ...)
it('is registered in buildExtensions and in NOTEBOOK_TYPE_SCHEMA at 5', ...)
```

- [ ] **Step 2: Run to verify they fail** — `python -m pytest tests/test_import_notice.py tests/test_notebook_schema_guard.py -q -p no:cacheprovider` and `cd app && npx vitest run src/pages/journal-2-0/lib/importNoticeNode.test.js src/pages/journal-2-0/lib/notebookSchema.rail.test.js`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement** the two modules and every table row listed under Files. Use `grep -rn '"webEmbed"' api tests` and `grep -rln "webEmbed" app/src` to confirm no per-type table was missed; a missed one is a bug, not a follow-up.

- [ ] **Step 4: Run** the Step 2 commands plus `python -m pytest tests/test_public_note_payload.py tests/test_notes_export_formats.py tests/test_notebook_fin_sec_gallery_attrs.py -q -p no:cacheprovider` and `cd app && npx vitest run src/pages/journal-2-0/lib/askCitation.parity.test.js src/pages/journal-2-0/lib/importer/exportFormats.roundtrip.test.js`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(notebook): importNotice block — the in-note marker for anything an import could not bring over`

---

### Task 6: Failed media is visible and retried, bounded (I-7)

Repro to turn into a test: `scratchpad/notion/test_media_retry.py` (a failed image vanished with no trace, pending=0, never retried).

**Files:**
- Modify: `api/services/journal_two/note_connectors/convert/rewrite.py`
- Modify: `api/services/journal_two/note_connectors/engine.py` (`_upload_media_for_note` ~1150, `_confirm_and_resolve_batch` ~1400-1460, `_bulk_existing_note_meta`, `_do_sync` result + `_finish_log`)
- Modify: `api/services/journal_two/import_notice.py` (`media_pending_state`), `api/services/journal_two/notes.py` (`import_confirm` skip gate + pending computation)
- Depends on: Plan D's `j2_note_sync_log.failures_json` DDL (Plan A adds no ALTER). `_finish_log` checks the column once per process (`PRAGMA table_info(j2_note_sync_log)`, cached) and skips the write when it is absent, so merge order can never break a sync.
- Test: `api/services/journal_two/test_note_connectors_engine.py`, `api/services/journal_two/note_connectors/convert/test_rewrite.py` (find with Glob `**/test*rewrite*.py`; create beside the converter tests if absent)

**Interfaces:**
- Consumes: `import_notice.notice_node`, `marker_text`, `is_retryable`, `notice_attempts_by_ref`, `MEDIA_RETRY_MAX_ATTEMPTS` (Task 5).
- Produces (`rewrite.py`): `rewrite_body(body_json, media_urls=None, id_by_key=None, *, strip_unresolved_links=True, notices: dict[str, dict] | None = None) -> tuple[dict, list[str]]`. When `notices` is not None, an `image`/`attachmentChip` placeholder whose ref is in `notices` is REPLACED by `notices[ref]` (an `importNotice` node) instead of dropped. `notices=None` keeps today's JS-parity behaviour byte-for-byte.
- Produces (`import_notice.py`): `def media_pending_state(body_json: Any) -> int` — 1 if the body holds `import-ref://` or a retryable notice; else 2 if it holds a `storage_limit` notice; else 0.
- Produces (engine): `_upload_media_for_note(provider, creds, user_id, note_id, media_entries, *, prior_attempts: dict[str, int]) -> tuple[dict[str, str], dict[str, dict], int, list[str]]` ⇒ `(media_urls, notices, uploaded, failures)`; `_notice_for_exception(exc: Exception, *, ref: str, name: str, source_url: str | None, attempts: int) -> dict` (`NoteConnTransient`/other ⇒ `fetch_failed`; `NoteConnUnsupported` whose reason names a private/non-https address ⇒ `unsafe`; other `NoteConnUnsupported` ⇒ `unsupported`; `NoteValidationError` from the save ⇒ `unsupported`). Media entries may carry an optional `source_url` (http(s) only).
- Produces: `import_confirm` treats `import_media_pending == 2` like 0 for the skip gate (waiting for space must not re-import every pass).
- Produces ([D]): `_finish_log(log_id, *, status, counts, error=None, source_deleted=0, failures_json: list[dict] | None = None)` writes `j2_note_sync_log.failures_json` = JSON array of `{"noteTitle": str, "reason": str, "name": str | null}` (reason = `marker_text(...)` of each notice written this pass, cap 50), NULL when empty. The `_do_sync` result's `failures` list is unchanged.

- [ ] **Step 1: Write the failing tests**

```python
async def test_failed_image_leaves_a_visible_notice_and_stays_pending(source, provider):
    # media ref https://cdn.example.com/a.png, provider raises on it
    r1 = await engine.sync_source(source["id"], full=True)
    body = _body(notes_svc.list_notes("u1")[0])
    notice = _only(body, "importNotice")
    assert notice["attrs"] == {"reason": "fetch_failed", "name": "a.png",
        "sourceUrl": "https://cdn.example.com/a.png", "ref": "https://cdn.example.com/a.png", "attempts": 1}
    assert _row(...)["import_media_pending"] == 1
    assert json.loads(_log_rows(source["id"])[-1]["failures_json"]) == [
        {"noteTitle": "Chart page", "reason": "Couldn't copy a.png — retrying on the next sync", "name": "a.png"}]
async def test_clean_pass_writes_null_failures_json(source, provider): ...
async def test_finish_log_tolerates_a_db_without_failures_json(source, provider): ...  # drop column via fresh schema without it -> sync ok

async def test_retry_replaces_the_notice_with_the_image(source, provider): ...   # media available on pass 2 -> image node, no notice, pending 0
async def test_retry_stops_after_max_attempts_with_a_final_notice(source, provider):
    # 3 failing full passes -> attempts == 3, pending == 0, 4th pass: fetch_media not called again
async def test_retry_bookkeeping_never_moves_updated_at(source, provider): ...
async def test_edited_note_with_failed_media_is_left_alone(source, provider): ...  # G1 holds: no retry write
def test_rewrite_without_notices_still_drops_for_js_parity(): ...
def test_rewrite_replaces_placeholder_with_notice_in_place(): ...  # position preserved inside a table cell
```

- [ ] **Step 2: Run to verify they fail** — `python -m pytest api/services/journal_two/test_note_connectors_engine.py -q -p no:cacheprovider -k "notice or retry or failed_image"`. Expected: FAIL (no `importNotice` in the body).

- [ ] **Step 3: Implement.** `_bulk_existing_note_meta` also returns `noticeAttempts` = `notice_attempts_by_ref(body)` for rows with `import_media_pending` in (1, 2) (select `body_json` only for those rows). Thread it to `_confirm_and_resolve_batch` per key (it must be read BEFORE confirm overwrites the body). For each media entry: skip the fetch when `prior_attempts[ref] >= MEDIA_RETRY_MAX_ATTEMPTS` and emit the final notice; else try, and on failure `attempts = prior + 1`. Pass `notices` to `rewrite_body`. `_apply_resolved_body` and `import_confirm` compute `import_media_pending = media_pending_state(body)`; `_body_has_import_placeholder` delegates to `media_pending_state(...) == 1` so there is one rule. Collect `{noteTitle, reason: marker_text(...), name}` for every notice written this pass and pass it to `_finish_log(..., failures_json=...)`.

- [ ] **Step 4: Run** the engine suite and `test_obsidian_ingest.py`. Expected: PASS.

- [ ] **Step 5: Mutation-prove** — make `is_retryable` always True; `test_retry_stops_after_max_attempts_with_a_final_notice` goes red.

- [ ] **Step 6: Commit** `fix(note-sync): an image that cannot be copied leaves a visible marker and is retried, up to 3 times`

---

### Task 7: Dependencies (HEIC decode + linkify) — the one `requirements.txt` change

**Files:**
- Modify: `requirements.txt`: add `pi-heif>=0.18,<1  # HEIC/HEIF decode for imported photos (api/services/journal_two/media_policy.py); decode-only build of pillow-heif, no x265 encoder` and `linkify-it-py>=2.0,<3  # bare-URL linkify for server imports (note_connectors/convert/linkify.py), the Python port of the client's linkify-it`; raise `Pillow>=10.0.0` to `Pillow>=11.3.0` (AVIF decode ships in Pillow's wheels from 11.x)
- Modify: `THIRD_PARTY_NOTICES.md` (pi-heif BSD-3 + bundled libheif/libde265 LGPL; linkify-it-py MIT)
- Test: `tests/test_media_deps.py` (new)

**Interfaces:**
- Produces: importable `pi_heif` (`pi_heif.register_heif_opener()`), `linkify_it.LinkifyIt`, and `PIL.features.check("avif") is True`.

- [ ] **Step 1: Write the test**

```python
def test_media_and_linkify_deps_are_importable():
    import pi_heif, linkify_it
    from PIL import features
    assert features.check("avif")
    assert linkify_it.LinkifyIt().test("see www.example.com")
```

- [ ] **Step 2:** `python -m pip install -r requirements.txt`, then run `python -m pytest tests/test_media_deps.py -q -p no:cacheprovider`. Expected: PASS. Verify a Linux cp312 wheel exists for `pi-heif` (`python -m pip download pi-heif --only-binary=:all: --platform manylinux2014_x86_64 --python-version 3.12 -d <scratch>`); if not, use `pillow-heif` and say so in THIRD_PARTY_NOTICES.

- [ ] **Step 3: Commit** `build(deps): pi-heif + linkify-it-py for connector media and links`. Ship needs the owner's `UCT_FLOW_OVERRIDE` step, outside 9:30–16:00 ET. Tasks 8 and 10 do not import these packages at module level (Task 8 degrades without `pi_heif`; Task 10 needs `linkify_it`), so Task 10 waits for this to deploy.

---

### Task 8: One media policy for every server path (I-1..I-4, Q2 cap) + the upload doors run it ([B A1])

**Files:**
- Create: `api/services/journal_two/media_policy.py`
- Modify: `api/services/journal_two/notes.py` (`save_note_attachment_bytes` gains `trusted_mime: bool = False`; widened safe extension map; `serve_note_image_path` unchanged)
- Modify: `api/routers/journal_two.py` (`serve_note_attachment` ~3990 headers; `upload_note_image_endpoint` ~3902 and `upload_note_attachment_endpoint` ~3965 run the policy; `/images` switches from `_NOTE_IMAGE_UPLOAD` (5 MB) to a new `_NOTE_MEDIA_UPLOAD` capped at `media_policy.MEDIA_SOURCE_MAX_BYTES`; `/hero` keeps `_NOTE_IMAGE_UPLOAD` and its current behaviour)
- Modify: `api/services/journal_two/note_connectors/engine.py` (`_upload_media_for_note` stores through the policy; budget per pass; storage-wait flip)
- Modify: `api/services/journal_two/note_connectors/convert/rewrite.py` (resolved media)
- Modify: `api/services/journal_two/note_connectors/providers/notion.py` `_resolve_media` cap: images download up to `MEDIA_SOURCE_MAX_BYTES` (was 5 MB) so oversize photos are downscaled instead of refused
- Test: `api/services/journal_two/test_media_policy.py` (new), `api/services/journal_two/test_note_connectors_engine.py`, `tests/test_note_upload_doors_media_policy.py` (new), existing `NoteEditorPage.attachments.test.jsx` (client response handling must tolerate the additive fields)

**Interfaces:**
- Consumes: `import_notice.marker_text` (Task 5); `rewrite_body(..., notices=...)` (Task 6); `pi_heif` if importable (Task 7) — `try: import pi_heif; pi_heif.register_heif_opener() except ImportError: HEIC ⇒ kept as a file`.
- Produces (`media_policy.py`), in addition to the Shared-interfaces names:
  - `IMAGE_MAX_BYTES = notes._MAX_IMAGE_BYTES`, `MEDIA_SOURCE_MAX_BYTES = notes._MAX_FILE_BYTES` (imported, never retyped)
  - `def sniff_mime(data: bytes, declared_mime: str | None, filename: str | None) -> str` — magic bytes win; else declared MIME with parameters stripped and `binary/octet-stream` read as `application/octet-stream`; else extension; else `application/octet-stream`
  - `@dataclass(frozen=True) class StoredMedia: kind: str; url: str; name: str; size: int; mime: str; width: int | None; height: int | None; original: "StoredMedia | None" = None`
  - `class MediaBudget: @classmethod def for_member(cls, user_id: str) -> "MediaBudget"; def reserve(self, nbytes: int) -> bool`
  - `def store_media(user_id: str, note_id: str, result: MediaResult, *, budget: MediaBudget) -> StoredMedia` (raises `MediaRejected("storage_limit", ...)` when `budget.reserve` refuses; the original counts against the budget too)
- Produces (`rewrite.py`): `rewrite_body(..., resolved: dict[str, StoredMedia] | None = None)` — an `image` placeholder whose `StoredMedia.kind == "image"` becomes `image{src=url}` followed, when `original` is set, by `attachmentChip{href, name, size}`; whose kind is `"file"` becomes an `attachmentChip`. An `attachmentChip` placeholder stays a chip (`size` filled).
- Produces (doors, [B A1]): both doors read the raw bytes, call `normalize_media(data, upload.content_type, upload.filename)` then `store_media(..., budget=MediaBudget.for_member(user_id))`, and answer the Shared-interfaces-1 shape; `MediaRejected` ⇒ `JSONResponse(400, {"detail": e.marker_text, "reason": e.reason})`. `_hand_off_to_documents` runs for the stored primary with `kind` = the STORED kind (an SVG sent to `/images` hands off as a file). The `/attachments` door keeps a chip-intent: an image sent there is stored as a file (`_as_file`, below), never silently re-routed to inline. The editor's own client-side 5 MB pre-check in `tiptap.js` is untouched (out of scope; the server door is now the more permissive one). Shared helper: `media_policy.as_file(result: MediaResult) -> MediaResult` = `result.original or replace(result, kind="file")`.

Policy (what `normalize_media` decides; values pinned by the tests):
- Over `MEDIA_SOURCE_MAX_BYTES` ⇒ `MediaRejected("too_large")`. Empty ⇒ `MediaRejected("unsupported")`.
- Sniffed HTML/XHTML/JS ⇒ `MediaRejected("unsupported")` (a web page is never stored as a file).
- PNG/JPEG/GIF/WebP ≤ `IMAGE_MAX_BYTES` ⇒ passthrough image (bytes untouched).
- HEIC/HEIF ⇒ JPEG (PNG if alpha), `original` = the HEIC as a file (Q2: lossy source, kept). TIFF/BMP/AVIF ⇒ JPEG/PNG, no original.
- Any raster over `IMAGE_MAX_BYTES` after the above ⇒ `ImageOps.exif_transpose`, longest edge 4096 px, JPEG q=85 (PNG with alpha), shrinking the edge ×0.75 up to 4 times until ≤ `IMAGE_MAX_BYTES`, else `MediaRejected("too_large")`; no original kept (Q2). An animated GIF/WebP over the cap: first frame as the image, the original kept as a file when ≤ 25 MB.
- Decoding runs under `warnings.simplefilter("error", Image.DecompressionBombWarning)`; a bomb ⇒ `MediaRejected("too_large")`.
- SVG ⇒ `kind="file"` (no rasteriser in the stack; never inline).
- Everything else ⇒ `kind="file"`, mime = sniffed/declared, never dropped.
- Serving: for `sub == "file"`, always `X-Content-Type-Options: nosniff`; for extensions `.svg .html .htm .xml .js .bin` also `Content-Disposition: attachment` and `Content-Security-Policy: sandbox`.
- The 2 GB cap applies to the engine and to every upload through `/images` and `/attachments` (the doors cannot tell an import upload from an editor upload; Plan B sends no marker). Owner may narrow this to imports later by adding a form field.
- `member_media_bytes(user_id)` = total size of files under the member's attachment directory in every read root (`attachment_root.read_candidates`), via `os.scandir` recursion. (No attachment-row table exists; see Ambiguities.)
- Storage wait: at the start of `_import_remote_notes`, when `member_media_bytes(user) < MEMBER_IMPORT_MEDIA_CAP_BYTES`, run `UPDATE j2_notes SET import_media_pending = 1 WHERE user_id = ? AND import_media_pending = 2` (timestamp-neutral).

- [ ] **Step 1: Write the failing policy tests** (build inputs with Pillow in the test; no binary fixtures needed except one tiny committed `.heic` under `api/services/journal_two/testdata/` marked `pytest.mark.skipif(not _has_pi_heif)`)

```python
def test_declared_mime_parameters_and_binary_octet_stream_are_ignored_in_favour_of_bytes():
    assert normalize_media(PNG, "image/png; charset=binary", "x").mime == "image/png"
    assert normalize_media(PNG, "binary/octet-stream", "quote.ashx").kind == "image"
def test_nameless_web_clip_image_is_typed_from_content(): ...      # filename "clip-image", JPEG bytes
def test_tiff_bmp_avif_convert_to_inline_images_without_originals(): ...
def test_heic_converts_and_keeps_the_original_as_a_file(): ...    # original.kind == "file", original.mime == "image/heic"
def test_oversize_photo_is_downscaled_under_5mb(): ...            # 30 MP noisy JPEG ~12 MB -> len(data) <= 5*1024*1024
def test_conversion_applies_exif_orientation(): ...               # EXIF Orientation=6, 400x200 -> output 200x400
def test_svg_is_a_downloadable_file_never_an_image(): ...
def test_video_audio_office_zip_are_kept_as_files(): ...          # mp4/mov/wav/pptx/zip bytes -> kind "file"
def test_bomb_and_disguised_html_are_rejected_not_stored(): ...   # reason "too_large" / "unsupported"
def test_over_25mb_is_too_large(): ...
def test_cap_reached_mid_note_imports_the_note_and_marks_the_rest(source, provider, monkeypatch):
    monkeypatch.setattr(media_policy, "MEMBER_IMPORT_MEDIA_CAP_BYTES", len(PNG) * 2)
    # note with 3 images -> 2 image nodes + 1 importNotice(reason="storage_limit"); pending == 2; status "ok"
async def test_storage_wait_retries_once_space_frees(source, provider, monkeypatch): ...
def test_images_door_accepts_raw_bytes_under_declared_mime(client): ...
    # content_type "image/png; charset=binary" with JPEG bytes -> 200 {"kind": "image", "url": ..., "name": ...}
def test_images_door_converts_heic_and_reports_the_original(client): ...  # original == {"url": ..., "name": "IMG.heic"}
def test_images_door_accepts_an_8mb_photo_and_downscales_it(client): ...  # was a 413 at 5 MB
def test_images_door_refusal_carries_a_reason(client): ...      # disguised HTML -> 400 {"detail": <sentence>, "reason": "unsupported"}
def test_attachments_door_keeps_any_file_type(client): ...      # .mov / .pptx -> 200 kind "file"
def test_hero_door_is_unchanged(client): ...                     # 6 MB -> refused exactly as today
def test_upload_doors_404_for_another_members_note(client): ...
def test_svg_attachment_is_served_download_only(client): ...    # Content-Disposition: attachment, CSP sandbox
```

- [ ] **Step 2: Run to verify they fail** — `python -m pytest api/services/journal_two/test_media_policy.py tests/test_note_upload_doors_media_policy.py -q -p no:cacheprovider`. Expected: FAIL (module missing; doors still MIME-refuse).

- [ ] **Step 3: Implement `media_policy.py`** and the `notes.py` change (`trusted_mime=True` skips `_ALLOWED_FILE_MIMES`; extension map adds `.mp4 .mov .webm .wav .ogg .m4a .mp3 .pptx .ppt .doc .xls .rtf .json .epub .heic .tif .tiff .bmp .avif .svg .gif .png .jpg .webp .key`, anything else `.bin`). The editor's existing `/images` and `/attachments` doors are unchanged.

- [ ] **Step 4: Wire the engine.** `_upload_media_for_note` builds one `MediaBudget.for_member(user_id)` per `_import_remote_notes` call (pass it in), runs `normalize_media` → `store_media`, puts `StoredMedia` in `resolved`, and turns `MediaRejected` into `notice_node(e.reason, ..., attempts=...)` (only `fetch_failed` counts attempts). `rewrite_body` receives `resolved` and `notices`.

- [ ] **Step 5: Switch the two doors and add the serving headers.**

- [ ] **Step 6: Run** `python -m pytest api/services/journal_two/test_media_policy.py tests/test_note_upload_doors_media_policy.py api/services/journal_two/test_note_connectors_engine.py api/services/journal_two/test_attachment_gc.py tests/test_inline_image_precheck_parity.py -q -p no:cacheprovider` (Glob the last one if it lives elsewhere) and `cd app && npx vitest run src/pages/journal-2-0/components/notebook/NoteEditorPage.attachments.test.jsx`. Expected: PASS. Confirm `attachment_gc`'s upload-name filter still matches the new files (32-hex + extension).

- [ ] **Step 7: Mutation-prove** — swap `sniff_mime`'s order so the declared MIME wins; `test_declared_mime_parameters_and_binary_octet_stream_are_ignored_in_favour_of_bytes` goes red.

- [ ] **Step 8: Commit** `feat(note-sync): one media policy — sniff, convert HEIC/TIFF/BMP/AVIF, downscale, keep every file, 2 GB per-member cap`

---

### Task 9: Hotlinks are copied in; data: images decode; redirects followed (I-5, I-6)

**Files:**
- Modify: `api/services/journal_two/note_connectors/providers/base.py` (`assert_public_https`, `guarded_media_stream`, `guarded_media_get`: keyword `allow_http: bool = False`)
- Modify: `providers/notion.py` (`fetch_media` → `guarded_media_get(..., allow_http=True)`; `_get_media_bytes` → `guarded_media_stream(..., max_bytes=cap)`), `providers/obsidian.py`, `providers/dropbox.py`, `providers/onedrive.py`, `providers/onenote.py`, `providers/roam.py`, `providers/craft.py` content-URL branches (`allow_http=True` only where the URL came from note content)
- Modify: `convert/mddoc.py` (`_strip_unsupported_data_uri_images` becomes `_extract_data_uri_images`; `_DATA_URI_RE` accepts non-base64 percent-encoded payloads; the HTML `<img src="data:...">` path), `engine.py` `_decode_data_uri`
- Modify: `api/routers/journal_two.py` — new `POST /notes/media/fetch` ([B A2], Shared interfaces 1); register it BEFORE any `/notes/{note_id}/...` POST route that could shadow it; Limiter scope `notebook-media-fetch` 120/minute keyed on the member via `api/limiter.py`; add the scope to CLAUDE.md's single-process Limiter list in the same commit
- Test (route): `tests/test_note_media_fetch_route.py` (new)
- Test: `api/services/journal_two/note_connectors/test_note_connectors_ssrf.py` (find the existing SSRF tests with Grep `assert_public_https` under `test_*`; add beside them), `api/services/journal_two/test_note_connectors_notion.py` (Glob `**/test*notion*.py`), mddoc tests, engine tests

**Interfaces:**
- Produces: `assert_public_https(url, *, what=..., allow_http: bool = False) -> str` — with `allow_http`, `http` and `https` both pass the scheme check; the address check is unchanged and runs on every redirect hop.
- Produces: media entries from content URLs carry `source_url` (Task 6 interface) so a failure notice links to the original.
- Produces: mddoc registers every `data:image/*` URI (any image MIME, base64 or percent-encoded) as a media entry `{ref: "md-img-N.<ext>", kind: "image", name, data_uri}`; non-image `data:` stays a visible text marker.

- [ ] **Step 1: Write the failing tests** (`httpx.MockTransport`, monkeypatch `base._resolve_host`)

```python
async def test_http_hotlink_is_downloaded_and_rehosted(): ...         # http://cdn.example.com/a.png -> stored, src is /api/j2/notes/attachments/...
async def test_notion_external_media_follows_redirects(): ...         # 302 -> https://cdn2.example.com/real.png -> PNG stored
async def test_redirect_to_private_address_is_unsafe_notice(): ...    # 302 -> http://169.254.169.254/ -> importNotice reason "unsafe"
async def test_failed_hotlink_notice_links_to_the_original(): ...     # 404 -> notice sourceUrl == the URL
def test_https_only_callers_still_refuse_http(): ...                  # allow_http defaults False
def test_svg_and_heic_data_uris_become_media_entries(): ...           # md_to_tiptap media has data_uri, doc has import-ref
def test_percent_encoded_svg_data_uri_decodes(): ...                  # data:image/svg+xml,%3Csvg... -> bytes start with b"<svg"
def test_data_text_html_stays_text(): ...
def test_media_fetch_door_copies_an_http_hotlink(client): ...   # {"url": "http://cdn.example.com/a.png", "noteImportKey": k} -> 200 {"src": "/api/j2/notes/attachments/...", "kind": "image", "filename": "a.png"}
def test_media_fetch_door_unsafe_redirect_is_422(client): ...   # -> 422 {"reason": "unsafe", "markerText": ...}
def test_media_fetch_door_404s_without_a_member_note(client): ...  # absent key, unknown key, another member's key
def test_media_fetch_door_is_rate_limited(client): ...
```

- [ ] **Step 2: Run to verify they fail** — run the test files above with `-k "hotlink or redirect or data_uri or http"`. Expected: FAIL.

- [ ] **Step 3: Implement.** Keep the default `allow_http=False` so every existing https-only call site is unchanged; only content-URL fetches opt in. Notion's internal S3 download keeps its `_MediaTooLarge` behaviour by mapping `NoteConnUnsupported` "exceeds the cap" to the existing `too_large` result.

- [ ] **Step 4: Run** the Step 1 files plus `python -m pytest api/services/journal_two/note_connectors -q -p no:cacheprovider`. Expected: PASS.

- [ ] **Step 5: Commit** `fix(note-sync): hotlinked and data: images are copied into UCT; redirects followed through the SSRF guard`

---

### Task 10: Bare URLs become links on every server path + scheme normalization (L-3, L-4)

Needs Task 7 deployed (`linkify_it`).

**Files:**
- Create: `api/services/journal_two/note_connectors/convert/linkify.py`
- Modify: `api/services/journal_two/note_connectors/engine.py` (`_finalize_remote_doc` applied to every `RemoteNote` right after `_fetch_remote_notes`, before hashing)
- Test: `api/services/journal_two/note_connectors/convert/test_linkify.py` (new), engine tests

**Interfaces:**
- Produces: `linkify_doc(doc: dict) -> dict` (Shared interface 5) and `normalize_link_hrefs(doc: dict) -> dict`: every `link` mark whose href is not allowed by `mddoc._is_allowed_link_href` (unsafe and app-deep-link schemes) or is relative/`#fragment` (anything not `http(s):`, `mailto:`, `tel:`, `/journal`, `/terminal?cmd=`, `import-link://`) loses its mark and keeps its text. Pure, deep-copying.
- Produces: `engine._finalize_remote_doc(doc: dict) -> dict` = `linkify_doc(normalize_link_hrefs(doc))`. The single chokepoint for Notion rich text, Roam, Craft, OneNote, Dropbox and Obsidian.

- [ ] **Step 1: Write the failing tests**

```python
def test_bare_urls_www_and_email_become_links():
    out = linkify_doc(_doc("see https://example.com/x?y=1 and www.example.org or a@b.com"))
    assert _links(out) == [("https://example.com/x?y=1", "https://example.com/x?y=1"),
                           ("www.example.org", "http://www.example.org"), ("a@b.com", "mailto:a@b.com")]
def test_fuzzy_bare_domains_never_link():   # Plan B's rule: tickers are not domains
    assert _links(linkify_doc(_doc("NVDA.US and example.com and ftp://x.org and //cdn.x"))) == []
def test_linkify_edge_punctuation_and_code():
    # "(see https://x.com/a)." -> href https://x.com/a ; inline code and codeBlock untouched;
    # a run already marked link untouched; bold mark kept on the linkified run
def test_linkify_is_pure(): ...                         # input deep-equal before/after
def test_unsafe_and_app_schemes_and_relative_links_become_text(): ...
    # javascript:, data:, file:, evernote:, notion://, obsidian://, onenote:, "../x.html", "#top"
def test_internal_and_pending_links_are_kept(): ...     # /journal?..., /terminal?cmd=x, import-link://k
async def test_every_provider_doc_is_finalized_before_hashing(source, provider): ...
    # FakeProvider doc with a bare URL -> stored body has the link mark
```

- [ ] **Step 2: Run to verify they fail** — `python -m pytest api/services/journal_two/note_connectors/convert/test_linkify.py -q -p no:cacheprovider`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** with one module-level `LinkifyIt()` (markdown-it's linkify defaults), then KEEP a match only when its schema is `http:`/`https:`/`mailto:`, or it is a fuzzy email, or its raw text starts with `www.` (case-insensitive); drop every other fuzzy link, `ftp:` and `//` match. This is Plan B's client rule, stated once per side; a shared vector file `app/src/pages/journal-2-0/lib/importer/__fixtures__/linkify_vectors.json` (create it if Plan B has not) is asserted by both this test file and Plan B's client test, so the two cannot drift. Walk block nodes; skip `codeBlock` subtrees; for each run of adjacent text nodes in a textblock, match on the concatenated text so a URL split across marks is found, and only split text nodes that carry no `code` or `link` mark.

- [ ] **Step 4: Run** the new tests and `python -m pytest api/services/journal_two/note_connectors api/services/journal_two/test_note_connectors_engine.py -q -p no:cacheprovider`. Expected: PASS (the convert-level parity rails are unaffected: finalize runs in the engine, after conversion).

- [ ] **Step 5: Commit** `feat(note-sync): bare URLs become clickable links on every connector; unsafe and dead-relative links become text`

---

### Task 11: Notion links point where they pointed (N-4, N-5)

**Files:**
- Modify: `api/services/journal_two/note_connectors/convert/notion_blocks.py` `_rich_text_to_inline` (~207-248)
- Test: `api/services/journal_two/test_note_connectors_notion.py` (or the converter test file next to it; copy the cases in `scratchpad/notion/repro1.py`)

**Interfaces:**
- Produces: `notion_page_id_from_href(href: str) -> str | None` — accepts `/<32hex>`, `/<slug>-<32hex>`, `https://www.notion.so/[<workspace>/]<slug>-<32hex>`, `https://<sub>.notion.site/<slug>-<32hex>`, `notion://www.notion.so/...`, with any `?query`/`#fragment`; returns the dashed lowercase UUID (`8-4-4-4-12`), the same shape as `mention.page.id` and the `notion:{page_id}` import key.

- [ ] **Step 1: Write the failing tests**

```python
def test_link_mention_is_a_link_to_the_url(): ...        # text "Example Domain", href https://example.com/article
def test_link_preview_mention_is_a_link(): ...
def test_database_mention_links_to_its_notion_url(): ... # href == rt["href"] (databases are not notes)
def test_workspace_relative_link_maps_to_the_imported_page():
    out = _rich_text_to_inline([rt("my other page", href="/1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6")])
    assert out[0]["marks"][-1]["attrs"]["href"] == "import-link://notion:1a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6"
def test_notion_so_and_notion_site_links_map_too(): ...
def test_user_and_date_mentions_stay_text(): ...
def test_external_link_annotations_kept(): ...           # bold + link
```

- [ ] **Step 2: Run to verify they fail.** Expected: FAIL (mentions come back as plain text; relative href copied raw).

- [ ] **Step 3: Implement.** A text `href` for which `notion_page_id_from_href` answers becomes `import-link://notion:<uuid>`; an unresolved one heals later (Task 4) and opens notion.so meanwhile (Task 2). Mention kinds: `page` (today), `link_mention` → `link_mention.href`, `link_preview` → `link_preview.url`, `database` → `rt["href"]`, others text.

- [ ] **Step 4: Run** the Notion tests and the engine suite. Expected: PASS.

- [ ] **Step 5: Commit** `fix(notion): link mentions, previews and in-workspace links stay links`

---

### Task 12: Notion databases, labels and video embeds (N-8, N-9, I-4 video)

**Files:**
- Modify: `api/services/journal_two/note_connectors/convert/notion_blocks.py` (`_property_inline` new, `_database_table_node` ~346 now takes resolved file nodes, `_child_database` ~650, `_link_to_page` ~684, `_media_block` ~746, `_external_link_block` ~788; constructor gains optional `fetch_title`)
- Create: `api/services/journal_two/note_connectors/convert/web_embed.py`
- Modify: `providers/notion.py` `_build_converter` (wire `fetch_title` to `_page_meta` cache, else `GET /pages/{id}`, failure ⇒ None)
- Test: Notion converter tests (cases from `scratchpad/notion/repro2.py`), `tests/test_web_embed_parity.py` (new)

**Interfaces:**
- Produces: `NotionBlockConverter(*, fetch_children, query_database, resolve_media, fetch_title: Callable[[str], Awaitable[str | None]] | None = None)`.
- Produces: `_property_inline(prop: dict, *, row_id: str, file_nodes: list[dict]) -> list[dict]` — `url`/`email`/`phone_number` ⇒ linked text (`mailto:`/`tel:`); `rich_text`/`title` ⇒ `_rich_text_to_inline`; a `title` cell additionally links to `import-link://notion:<row_id>`; everything else ⇒ today's `_property_plain_text`.
- Produces: `web_embed.embed_for(url: str) -> tuple[str, str] | None` — `("youtube", <11-char id>)` or `("tradingview", <ref>)`, a port of `lib/webEmbeds.js::embedFor` (host sets and id patterns PARSED from the JS file by the parity test, never restated).

- [ ] **Step 1: Write the failing tests**

```python
async def test_database_url_cell_is_a_link(): ...
async def test_database_rich_text_cell_keeps_hrefs(): ...
async def test_database_files_cell_rehosts_image_inline_and_file_as_chip(): ...
    # files: chart.png (type file, S3 url) -> image import-ref in the cell, media registered; deck.pptx -> attachmentChip
async def test_database_row_title_links_to_the_row_note(): ...
async def test_link_to_page_uses_the_target_title(): ...           # fetch_title returns "Q3 Plan" -> text "Q3 Plan"
async def test_link_to_page_falls_back_to_linked_page(): ...       # fetch_title -> None
async def test_youtube_video_block_is_a_web_embed_not_a_download(): ...  # external youtu.be url -> webEmbed, media == []
async def test_vimeo_video_block_is_a_plain_link(): ...
def test_embed_for_matches_the_client_allowlist(): ...             # parses lib/webEmbeds.js
```

- [ ] **Step 2: Run to verify they fail.** Expected: FAIL.

- [ ] **Step 3: Implement.** In `_child_database`, before building the table, resolve each `files` property item through `self._resolve_media` with a synthesized block `{"type": "image" if <image extension> else "file", "id": f"{row_id}:{prop}:{i}", <type>: item}` and register it on the note's `_Media`; a `None` resolution becomes a `[file unavailable: name]` text, as `_media_block` does today. `_media_block` for `video`/`embed` with an external URL: `embed_for` match ⇒ `{"type": "webEmbed", "attrs": {"provider", "ref", "url"}}`; no match for `video`/`embed` ⇒ plain link. Bookmarks and link previews stay plain links (no metadata to fill a card).

- [ ] **Step 4: Run** the Notion tests, `tests/test_web_embed_parity.py`, `tests/test_public_note_payload.py`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(notion): database cells keep links and files, page links carry titles, YouTube becomes an embed`

---

### Task 13: Obsidian links that heal later, relative links, and server polish (O-4, O-5, §5.2 polish)

**Files:**
- Modify: `api/services/journal_two/note_connectors/providers/obsidian.py` (`_transform_wiki_and_embeds`, `_resolve_target`, `_convert_row`, callout pre-pass)
- Modify: `api/services/journal_two/note_connectors/convert/mddoc.py` (`md_to_tiptap(md, *, resolve_href=None)`; raw inline `<img>`/`<a>` handling)
- Modify: `api/services/journal_two/note_connectors/link_keys.py` (`name:obsidian:` kind)
- Modify: the parity summary in both rails: a `name:` pending link is reported under `pending` (server only), never under `links`
- Test: `api/services/journal_two/test_obsidian_provider.py`, `api/services/journal_two/test_note_link_keys.py`, `api/services/journal_two/test_obsidian_ingest.py` (end-to-end, shape of `scratchpad/obsidian/test_obs_e2e.py`)

**Interfaces:**
- Consumes: `resolve_link_keys` / `heal_pending_links` (Task 4).
- Produces: `md_to_tiptap(md: str | None, *, resolve_href: Callable[[str], str | None] | None = None) -> dict` — called with the decoded destination of every scheme-less, non-`#` link; a returned string replaces the href (and is collected into `links` when it is `import-link://`); `None` keeps today's behaviour (Task 10 then turns a dead relative href into text).
- Produces: link key `name:obsidian:<vault_id>/<target>` where `<target>` is the wikilink target as written, fragment stripped, lowercased; resolved by `resolve_link_keys` against `import_key LIKE 'obsidian:<vault_id>/%'` with the SAME `_resolve_target` rules as conversion time.
- Produces: `_resolve_target(raw_target, paths, basename_map, *, from_path: str | None = None) -> str | None` — for a bare name with several candidates: same folder as `from_path` first, then the shortest path, then first seen.

- [ ] **Step 1: Write the failing tests**

```python
async def test_link_to_a_note_created_later_heals_without_repushing_the_source(client): ...
    # Src.md "[[Later]]" synced; then Later.md pushed alone; incremental sync ->
    # Src body link href == /journal?j2tab=notebook&note=<Later id>; Src updated_at unchanged
def test_unresolved_wikilink_keeps_display_text_and_a_pending_key(): ...
def test_relative_markdown_links_resolve(): ...     # [x](Other%20note.md), [x](../Notes/Other.md), [x](<Other note.md#Heading>)
def test_obsidian_deep_link_resolves_within_the_vault(): ...  # obsidian://open?vault=V&file=Notes%2FOther -> note link
def test_heading_anchor_display_reads_note_then_heading(): ... # [[Other note#Risk]] -> "Other note > Risk"
def test_note_embed_text_has_no_md_extension(): ...  # ![[Other note]] -> link text "Other note"
def test_callout_becomes_a_native_callout(): ...      # "> [!warning] Size\n> text" -> callout variant warning
def test_duplicate_basenames_prefer_same_folder_then_shortest(): ...
def test_raw_img_and_a_html_become_image_and_link(): ...
```

- [ ] **Step 2: Run to verify they fail.** Expected: FAIL.

- [ ] **Step 3: Implement.** Unresolved wikilink ⇒ `[display](<import-link://name:obsidian:{vault}/{target}>)`. The provider passes `resolve_href` resolving relative `.md` paths against the note's own folder, then vault root, then `_resolve_target`. Callout variants map onto `GALLERY_CALLOUT_VARIANTS` (`note`, `info`, `success`, `warning`, `danger`; `tip`→`success`, `caution`/`important`→`warning`, `bug`/`failure`→`danger`, unknown→`note`). Footnotes and `|300` widths stay out of scope (§5.6).

- [ ] **Step 4: Regenerate the parity fixtures and run** `python -m pytest api/services/journal_two/test_obsidian_provider.py api/services/journal_two/test_obsidian_ingest.py api/services/journal_two/test_obsidian_parity_fixtures.py api/services/journal_two/test_note_link_keys.py -q -p no:cacheprovider` and the JS parity rail. Where the client lane (Plan B) has not yet adopted a rule (duplicate basenames, callouts, relative links), add a named `knownClientGap` entry naming Plan B's task; never a normalization.

- [ ] **Step 5: Commit** `feat(obsidian): links to notes created later heal, relative links resolve, callouts and anchors come over`

---

### Task 14: Messy real-world corpora for Notion and Obsidian-server (§10)

**Files:**
- Create: `api/services/journal_two/note_connectors/corpora/notion_messy.json` (a workspace dump: pages with page/link/database/user mentions, in-workspace links, an unshared target, a trashed target, a ≤50-row database with url/rich_text/files/title cells, a >50-row database, image/file/video(YouTube + mp4)/pdf/audio blocks, an expired S3 url (403 then fresh), a `binary/octet-stream` PNG, a HEIC, a 12 MB JPEG, an SVG, a redirecting external image, a dead external image, a bookmark, bare URLs in paragraphs and in a code block)
- Create: `.../corpora/obsidian_messy/` (vault: names with spaces, `attachments/` folder, `| [[a\|b]] |` tables, embeds, `![](https://...)` hotlinks, an `http://` image, a data: SVG, a later-created target, relative links, a callout, duplicate basenames)
- Create: `.../corpora/corpora_gen.py` (runs the REAL engine end-to-end against each corpus — Notion through `httpx.MockTransport` with `base._resolve_host` patched, Obsidian through the staging tables — and writes the stored bodies to `app/src/pages/journal-2-0/lib/importer/__fixtures__/connector_corpora/*.json`; same regenerate-and-diff shape as `obsidian_parity_fixtures_gen.py`)
- Create: `api/services/journal_two/note_connectors/test_connector_corpora.py`, `app/src/pages/journal-2-0/lib/connectorCorpora.dom.test.js`

**Interfaces:**
- Consumes: everything above. Each corpus construct gets ONE named assertion on the stored document (server) and ONE on the rendered DOM (client), never on a normalized copy.

- [ ] **Step 1: Write the server rail** — one test per construct, e.g.:

```python
def test_corpus_notion_in_workspace_link_is_a_note_link(stored): assert _href(stored, "Q3 plan") == f"/journal?j2tab=notebook&note={ids['q3']}"
def test_corpus_notion_unshared_target_is_pending(stored): assert _href(stored, "Secret") == "import-link://notion:<uuid>"
def test_corpus_notion_heic_renders_and_keeps_original(stored, attachment_root):
    img = _image(stored, near="IMG_0412"); w, h = Image.open(_path(img["src"])).size
    assert (w, h) == (4032, 3024) and _chip(stored, near="IMG_0412")["name"].endswith(".heic")
def test_corpus_notion_dead_image_has_a_notice_with_its_url(stored): ...
def test_corpus_notion_youtube_is_an_embed(stored): ...
def test_corpus_obsidian_space_named_link_resolves(stored): ...
def test_corpus_obsidian_later_target_heals(stored): ...
def test_corpus_fixtures_are_current(): ...   # corpora_gen output equals the committed JSON byte-for-byte
```
Image "decodes with correct natural size" is asserted here, with Pillow on the stored bytes (jsdom performs no image decode).

- [ ] **Step 2: Write the client rail** — mount each fixture through `buildExtensions()` (read-only and editable), and assert per construct: every `<a href>` that should open is accepted by `openableLinkHref` or `internalNoteIdFromHref` or `pendingLinkFallbackHref`; every `<img src>` starts with `/api/j2/notes/attachments/`; no `import-ref://` anywhere; every `importNotice` renders its text.

- [ ] **Step 3: Run** `python -m api.services.journal_two.note_connectors.corpora.corpora_gen`, then `python -m pytest api/services/journal_two/note_connectors/test_connector_corpora.py -q -p no:cacheprovider` and `cd app && npx vitest run src/pages/journal-2-0/lib/connectorCorpora.dom.test.js`. Expected: PASS.

- [ ] **Step 4: Prove the rail can fail** — temporarily revert Task 3's `unquote` (edit, not `git checkout`); `test_corpus_obsidian_space_named_link_resolves` and the DOM rail go red; restore.

- [ ] **Step 5: Commit** `test(note-sync): messy Notion and Obsidian corpora, asserted on stored docs and rendered DOM`

---

## Self-review

**Spec coverage (Plan A scope):** §5.1 remaining → Task 4 (+ Task 1 so converter fixes cannot trip the conflict policy). L-1 → Task 2; L-2 → Task 2; L-3 → Task 10; L-4 → Task 10 (generic), Task 11 (notion deep links), Task 13 (obsidian deep links). N-4, N-5 → Task 11; N-8, N-9 → Task 12. O-1, O-8 → Task 3; O-4, O-5, server polish → Task 13 (footnotes and `|300` deliberately left to §5.6). I-1..I-4 + Q2 cap → Task 8; I-5, I-6 → Task 9; I-7 → Tasks 5, 6. §10 corpora + parity-rail fix → Tasks 3, 14. Shared interfaces: media policy + upload doors [B A1] → Task 8; fetch door [B A2] → Task 9; `importNotice` incl. client reasons [B A3] → Task 5; plain-text pending links [B A5] → Task 2; `evernote-title:` keys + heal door [B A5, A6] → Task 4; linkify rule [B] → Task 10; parity-fixture regeneration [B] → Task 3; `failures_json` writes [D] → Task 6. Not in Plan A: I-8/I-9, E-*, O-11 (client), §6-§9 (Plans B/C/D).

**Type consistency:** `rewrite_body` gains `notices` (Task 6) and `resolved` (Task 8), both keyword-only with `None` defaults; `import_media_pending` tri-state is defined once in `import_notice.media_pending_state` (Task 6) and `_body_has_import_placeholder` delegates to it; `resolve_link_keys` / `heal_pending_links` (Task 4) are extended, not renamed, in Task 13; `_write_import_hash_preserving_updated_at` keeps its name and gains `remote_rev`.

**Review Focus:** each of the five lines has a named test in its owning task (1, 8, 10, 8, 8/9).

**Proportion:** signatures, test names and assertions; bodies only where the rule is not determined by the signature (the conflict-gate order, the media policy table, the copy table).
