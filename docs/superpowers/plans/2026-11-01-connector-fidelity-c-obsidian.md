# Connector fidelity, Plan C: Obsidian live sync sends attachments. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member's Obsidian vault arrives in the UCT Notebook with every image visible and every referenced file kept as a downloadable attachment. Anything that can't come over gets a visible in-note marker. Older plugins keep working text-only and the member is told that updating brings images.

**Architecture:** The plugin resolves each note's embeds and links with Obsidian's own resolver (`metadataCache.getFileCache` + `getFirstLinkpathDest`). It hashes the referenced binaries, asks the server which hashes it lacks, and uploads only those, one raw-body `PUT` per blob. Then it pushes the notes over the existing staged-push protocol, with one new optional per-note field: `attachments`, a list of `{original, embed, path, size, sha256, status}`. The server stages the blobs on disk. Before `md_to_tiptap` runs, `providers/obsidian.py` swaps each `original` substring for a placeholder, then turns the placeholders into `image` / `attachmentChip` / `importNotice` nodes, and its `fetch_media` serves the staged bytes. Bytes then go through the engine's ordinary media phase, where plan A's `normalize_media` already runs. Whether a side supports attachments is negotiated, not assumed. A new plugin talking to an old server gets 404 from `/attachments/check` and falls back to 0.1.x behaviour, legacy hashes included. An old plugin talking to a new server sends no `attachments` field and no version header. The server records the version (or its absence) and the card tells that member to update.

**Tech Stack:** TypeScript + esbuild 0.25.5 + vitest (plugin, standalone repo); Python 3 / FastAPI / SQLite / pytest (server); React + vitest (dashboard card).

**Spec:** `docs/superpowers/specs/2026-11-01-connector-fidelity-and-evernote-design.md` (§5.3 I-8, §8 last paragraph, §9 "re-send once", §15 Q2). Executors read the spec and this plan.

## Where the plugin code lives (read first)

The monorepo copy `obsidian-plugin/` is a **stale 0.1.0 snapshot**. The published plugin is the standalone public repo **`unchartedterritory5995-cyber/obsidian-uct-notebook-sync`**, checked out at `C:/Users/Patrick/uct-worktrees/obsidian-uct-notebook-sync` (HEAD `e45c802`, tag `0.1.4`). It already carries the 9/4-9/5 review fixes the monorepo copy lacks: `setHeading()`, no plugin name in headings, command id `sync-now`, `instanceof TFile`, `TextEncoder`, `crypto.randomUUID()`, and a typed `createHash` slice. **Tasks 6-11 are executed in the standalone repo** on branch `feat/attachments-0.2.0`. Task 11 replaces the monorepo `obsidian-plugin/` with a pointer README, so a second, drifting copy does not survive. Nothing outside docs references `obsidian-plugin/`; this was checked with `git grep`. Tasks 1-5 are executed in the monorepo on branch `feat/obsidian-attachments`.

## Global Constraints

- Plugin `manifest.json` `id` stays `uct-notebook-sync`; `minAppVersion` stays `1.5.0`; new version **`0.2.0`**; `versions.json` gains `"0.2.0": "1.5.0"` and keeps every existing entry.
- Release tag is the **bare version** `0.2.0` (no `v`), and it equals `manifest.json` `version` and `package.json` `version`.
- Release assets are exactly `main.js`, `manifest.json`, `styles.css`. The released `main.js` sha256 MUST equal the sha256 of the binary that passed the production E2E (Task 11).
- Reproducible build: build with `npm ci && npm run build` from a clean clone of the release commit. Two independent clean builds (local Windows + CI ubuntu) must produce a byte-identical `main.js`.
- Obsidian review rules (from the 0.1.2/0.1.3 review findings):
  - Headings only via `new Setting(el).setName(..).setHeading()`, and never containing "UCT Notebook Sync".
  - Command ids must not repeat the plugin id.
  - Narrow with `instanceof TFile`, never by duck-typing.
  - No `Buffer`, no untyped bare-specifier Node imports. Use `TextEncoder`/`Uint8Array`/`ArrayBuffer`, plus the typed `createHash` slice in `hashing.ts`.
  - Network only via `requestUrl`.
  - No `innerHTML`; DOM only via `createEl`.
  - No APIs newer than 1.5.0, so no `getSettingDefinitions()` and no `setDestructive()`.
- Per-file attachment cap = `notes._MAX_FILE_BYTES` (25 MiB = 26214400). The server is the authority and sends it as `maxBytes`; the plugin never hard-codes it except as a fallback constant for tests.
- Per-member staged-attachment bound = plan A's `MEMBER_IMPORT_MEDIA_CAP_BYTES` (2 GB, env-overridable), plus `notes_quota.assert_import_headroom` before every blob write.
- Engine is NOT modified by this plan. Bookkeeping stays timestamp-neutral (§4). The conflict policy is unchanged: edited + remote changed ⇒ "(synced copy)" sibling.
- No new Python dependency, so no `requirements.txt` change and no `UCT_FLOW_OVERRIDE` step.
- Member copy uses no em dashes in new strings (house wire rule; apply to new UI copy too) and no emoji.
- Plan A owns the following. Consume them by exact name; never re-implement:
  - `api/services/journal_two/media_policy.py`: `normalize_media`, `MediaResult`, `MediaRejected`, `member_media_bytes(user_id) -> int`, `MEMBER_IMPORT_MEDIA_CAP_BYTES`.
  - The TipTap node `importNotice` with attrs `{reason, name, sourceUrl, ref, attempts}`.
  - The O-1 wikilink-key decode and the O-4 heal.
  - The engine media phase calling `normalize_media`, and the I-7 retry of failed media.
- Branch per repo, PR per repo. Master = production with standing GO to deploy when ready. If the classifier blocks `gh pr merge`, the owner merges.

## Review Focus

1. **Attachment names with spaces, `#`, `%`, unicode or parentheses** (`my chart #1 (v2).png`, `Ünïcode.png`). Expected: the image renders and the stored file name is exactly the vault file name. Pinned in Task 3: `test_attachment_names_round_trip_exactly`.
2. **One image used by many notes, or the same bytes under two paths.** Expected: uploaded once, rendered in every note, and no re-upload after a pure rename. Pinned in Task 10: `dedupes uploads by content hash across notes and renames`.
3. **New plugin against a server that predates this plan, then the server upgrades.** Expected: the 0.2.0 sync succeeds text-only with zero re-pushes; after the server upgrade the next sync re-sends exactly the notes that reference attachments, once. Pinned in Task 10: `legacy server keeps 0.1.x hashes, then re-sends attachment notes once after server upgrade`.
4. **A blob upload fails mid-run (network blip on blob 3 of 5).** Expected: notes still sync, the summary says some files will retry, and the next run uploads only the still-missing blobs even though no note changed. Pinned in Task 10: `an upload failure never blocks notes and the next run uploads only what is missing`.
5. **Sync right after Obsidian opens, before the metadata cache has indexed a note.** Expected: no crash and no wrong "update your plugin" marker that sticks. The note syncs text now and re-pushes with its attachments next run. Pinned in Task 8 (`waits for the metadata cache, then falls back to no refs`) and Task 10 (`a note indexed late re-pushes once with its attachments`).

---

## File structure

**Monorepo (`connector-fidelity-recon`, branch `feat/obsidian-attachments`)**
- Create `api/services/journal_two/note_connectors/obsidian_attachments.py`: the staged-blob store (disk + `j2_obsidian_attachments` rows), bounds, GC and purge. This is the only module that touches blob files.
- Modify `api/services/journal_two/db.py`: the `_J2_SCHEMA` block (~l.747-790), `_OBSIDIAN_TABLE_DDL` (~l.3923), and the additive ALTER list (~l.2600).
- Modify `api/services/journal_two/note_connectors/obsidian_staging.py`: store `attachments_json`; GC on `final`.
- Modify `api/services/journal_two/note_connectors/obsidian_link.py`: `record_plugin_version`, `plugin_versions_for_user`; `revoke_devices` also purges blobs.
- Modify `api/services/journal_two/account_purge.py`: table list + blob dir.
- Modify `api/routers/note_sync.py`: version header, two new routes, the `attachments` field on `ObsidianNoteItem`, and `pluginVersion` in `/status`.
- Modify `api/services/journal_two/note_connectors/providers/obsidian.py`: attachment pre-pass, placeholder promotion, old-plugin notices, `fetch_media` for staged refs.
- Modify `api/services/journal_two/note_connectors/convert/obsidian_parity_fixtures_gen.py`, `convert/obsidian_fixtures_in/04-embed-image.vault.json`, and add `convert/obsidian_fixtures_in/19-attachment-names.{md,vault.json}`. Regenerate `app/src/pages/journal-2-0/lib/importer/__fixtures__/obsidian_parity/*.json`.
- Modify `app/src/pages/journal-2-0/hooks/useNoteConnectors.js` (normalizeSource), `components/connectors/SourceRow.jsx` (update hint), and `components/connectors/ObsidianConnectModal.jsx` (consent copy).
- Modify `docs/feature_flags.json`: ledger `NOTE_SYNC_OBSIDIAN_ATTACHMENTS_ENABLED`.
- Tests:
  - `api/services/journal_two/test_obsidian_attachments.py` (new)
  - `test_obsidian_ingest.py`, `test_obsidian_provider.py`
  - `test_obsidian_attachments_e2e.py` (new)
  - `SourceRow.test.jsx`, `ObsidianConnectModal.test.jsx`

**Standalone plugin repo (`obsidian-uct-notebook-sync`, branch `feat/attachments-0.2.0`)**
- Create:
  - `.gitattributes`, `.nvmrc`, `.github/workflows/build.yml`
  - `src/server-url.ts` (URL validation)
  - `src/attachment-refs.ts`: pure classification of cache entries into `NoteAttachmentRef`s, MIME-by-extension, and `noteContentHash`
  - `src/attachment-sync.ts`: pure-ish orchestration of the check/upload phase over a `Transport` + `AttachmentSource`
- Modify:
  - `src/types.ts`, `src/hashing.ts`, `src/vault-source.ts`, `src/api-client.ts`
  - `src/batching.ts`, `src/sync-plan.ts`, `src/sync-manager.ts`
  - `src/settings.ts`, `src/main.ts`
  - `package.json`, `manifest.json`, `versions.json`, `README.md`
- Tests: `src/test/server-url.test.ts`, `attachment-refs.test.ts`, `vault-source.test.ts`, `attachment-sync.test.ts` (all new); extend `api-client.test.ts`, `batching.test.ts`, `sync-manager.test.ts`; extend `obsidian-stub.ts`.

---

## The wire protocol (shared by Tasks 2, 3, 9, 10). Exact.

Every plugin request carries the header `X-UCT-Plugin-Version: <manifest version>`.

`NoteAttachmentRef` (TS) / `ObsidianAttachmentRef` (pydantic). The same field names on both sides:

| field | type | meaning |
|---|---|---|
| `original` | str, 1..2048 chars | exact source substring from Obsidian's cache (`EmbedCache.original` / `LinkCache.original`), e.g. `![[chart.png\|300]]`, `![](attachments/x%20y.png)`, `[report](file.pdf)`, `[[file.pdf]]` |
| `embed` | bool | true when it came from `embeds` (renders inline if image), false from `links` (always a file chip) |
| `path` | str, 1..1024 | resolved vault path; for `missing`, the link path as written |
| `size` | int ≥ 0 | bytes from `TFile.stat.size`; 0 for `missing` |
| `sha256` | 64 lowercase hex or null | set for `ok` and `storage-limit`, null otherwise |
| `status` | `ok` \| `too-large` \| `missing` \| `off` \| `storage-limit` | |

- `ObsidianNoteItem.attachments: list[ObsidianAttachmentRef] | None = None`. This is omitted by 0.1.x and by 0.2.0 in legacy mode. When the field is present, the list holds at most `_MAX_ATTACHMENTS_PER_NOTE = 5000` entries; a batch over that is a 400 for the whole batch, the same as the existing I7 bounds.
- `POST /api/j2/notes/connectors/obsidian/attachments/check`, body `{"sha256": [..≤5000]}`. The response is `{"protocol": 1, "missing": [sha…], "maxBytes": 26214400, "remainingBytes": int}`. An empty list is valid and is how the plugin learns `protocol`/limits.
- `PUT /api/j2/notes/connectors/obsidian/attachments/{sha256}` takes a raw body plus these headers:
  - `Content-Type` is the declared MIME.
  - `X-UCT-Attachment-Name` is the percent-encoded basename.

  Responses:
  - `200 {"stored": true|false}`; `false` means the blob was already staged.
  - `400` for a hash mismatch or bad name.
  - `413 {"detail": ...}` for over `maxBytes` or over the member bound.
  - `503` for no volume headroom.
- Both new routes return **404** when `NOTE_SYNC_OBSIDIAN_ATTACHMENTS_ENABLED=0` (default on when unset). That is the same signal an older server gives, so the kill switch reuses the compatibility path.
- Media ref scheme written by the provider: `obsidian-att:<sha256>/<quote(basename, safe='')>` for an inline image and `obsidian-file:<sha256>/<quoted basename>` for a file chip.

---

### Task 1: Server attachment staging store (schema + `obsidian_attachments.py`)

**Files:**
- Create: `api/services/journal_two/note_connectors/obsidian_attachments.py`
- Modify: `api/services/journal_two/db.py` (the `_J2_SCHEMA` Obsidian block ~l.747-790, `_OBSIDIAN_TABLE_DDL` ~l.3923, the ALTER tuple ~l.2600)
- Modify: `api/services/journal_two/note_connectors/obsidian_link.py:380-447` (`revoke_devices`), `api/services/journal_two/account_purge.py:100-103,393-412`
- Test: `api/services/journal_two/test_obsidian_attachments.py`

**Interfaces:**
- Consumes: `notes_quota.assert_import_headroom(bytes_wanted: int)` (raises `NoteQuotaExceeded`); `media_policy.MEMBER_IMPORT_MEDIA_CAP_BYTES` (plan A); `notes._MAX_FILE_BYTES`.
- Produces:
  - `blob_root() -> Path`, i.e. `Path(os.environ.get("J2_OBSIDIAN_BLOB_ROOT") or Path(os.environ.get("DATA_DIR", "/data")) / "j2_obsidian_staging_blobs")`. This deliberately lives outside `attachment_root()`, so the nightly attachment backup never tars staging copies.
  - `MAX_BLOB_BYTES: int = notes._MAX_FILE_BYTES`
  - `class BlobRejected(Exception)` with `.status: int` (400/413/503) and `.detail: str`
  - `async stage_blob_stream(*, user_id, vault_id, sha256, declared_mime, name, chunks: AsyncIterator[bytes], declared_length: int | None) -> bool` returns True if newly stored, False if already staged.
  - `missing_hashes(user_id, vault_id, hashes: list[str]) -> list[str]`, order-preserving and deduped.
  - `remaining_bytes(user_id) -> int`
  - `read_blob(user_id, vault_id, sha256) -> tuple[bytes, str] | None`, returning `(data, declared_mime)`.
  - `gc_unreferenced(user_id, vault_id, *, older_than: timedelta = timedelta(hours=24)) -> int`
  - `purge_user(user_id) -> int`
- Schema:
  - `j2_obsidian_attachments(user_id TEXT NOT NULL, vault_id TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, declared_mime TEXT, name TEXT, received_at TEXT NOT NULL, PRIMARY KEY(user_id, vault_id, sha256))`
  - additive `j2_obsidian_staging.attachments_json TEXT`
  - additive `j2_obsidian_devices.plugin_version TEXT`

- [ ] **Step 1: Write the failing tests** in `test_obsidian_attachments.py`. Use the `auth_db._DB_PATH` + `ensure_schema` fixture pattern from `test_obsidian_ingest.py:43-66` and set `J2_OBSIDIAN_BLOB_ROOT` to `tmp_path`.

```python
async def _chunks(*parts):  # helper
    for p in parts: yield p

async def test_stage_then_read_round_trips_bytes_and_mime(env):
    data = b"\x89PNG\r\n\x1a\n" + b"x" * 100
    sha = hashlib.sha256(data).hexdigest()
    assert await oa.stage_blob_stream(user_id="u", vault_id="v", sha256=sha, declared_mime="image/png",
        name="chart one.png", chunks=_chunks(data[:10], data[10:]), declared_length=len(data)) is True
    assert oa.read_blob("u", "v", sha) == (data, "image/png")
    assert await oa.stage_blob_stream(user_id="u", vault_id="v", sha256=sha, declared_mime="image/png",
        name="chart one.png", chunks=_chunks(data), declared_length=len(data)) is False

async def test_hash_mismatch_rejected_and_nothing_left_on_disk(env):
    with pytest.raises(oa.BlobRejected) as e:
        await oa.stage_blob_stream(user_id="u", vault_id="v", sha256="0"*64, declared_mime=None,
            name="a.png", chunks=_chunks(b"abc"), declared_length=3)
    assert e.value.status == 400
    assert list(oa.blob_root().rglob("*")) == [] or all(p.is_dir() for p in oa.blob_root().rglob("*"))
    assert oa.missing_hashes("u", "v", ["0"*64]) == ["0"*64]

async def test_over_max_bytes_aborts_mid_stream_with_413(env, monkeypatch):
    monkeypatch.setattr(oa, "MAX_BLOB_BYTES", 10)
    with pytest.raises(oa.BlobRejected) as e:
        await oa.stage_blob_stream(user_id="u", vault_id="v", sha256="a"*64, declared_mime=None,
            name="a.bin", chunks=_chunks(b"123456", b"789012"), declared_length=None)
    assert e.value.status == 413

async def test_member_bound_refuses_with_413(env, monkeypatch):
    monkeypatch.setattr(oa, "MEMBER_IMPORT_MEDIA_CAP_BYTES", 5)
    assert oa.remaining_bytes("u") == 5
    with pytest.raises(oa.BlobRejected) as e:
        await oa.stage_blob_stream(user_id="u", vault_id="v", sha256=hashlib.sha256(b"123456").hexdigest(),
            declared_mime=None, name="a.bin", chunks=_chunks(b"123456"), declared_length=6)
    assert e.value.status == 413 and "storage" in e.value.detail.lower()
    assert oa.remaining_bytes("u") == 5  # nothing was counted

def test_missing_hashes_is_tenant_scoped(env): ...  # blob staged for (u,v) is "missing" for (u2,v) and (u,v2)

def test_gc_removes_only_unreferenced_old_blobs(env): ...
    # staged blobs A (referenced by a staging row's attachments_json) and B (unreferenced), both received 25h ago
    # -> gc_unreferenced returns 1, A survives (row + file), B's row and file are gone; a 1h-old unreferenced C survives

def test_revoke_devices_and_account_purge_remove_blobs(env): ...
    # after obsidian_link.revoke_devices("u"): no j2_obsidian_attachments rows for u, blob_root()/u absent
    # after account_purge.purge_user_data("u2", conn): same for u2

def test_schema_has_new_columns_on_an_old_db(tmp_path): ...
    # create the three 0.1-era tables with the OLD DDL, run ensure_schema, assert attachments_json and plugin_version exist
```

Replace the `...` bodies with the assertions stated in their comments. Every test is `pytest.mark.asyncio` where it awaits; follow the existing file's async style.

- [ ] **Step 2: Run to verify they fail.** Run: `python -m pytest api/services/journal_two/test_obsidian_attachments.py -q`. Expected: FAIL, `ModuleNotFoundError: ...obsidian_attachments`.

- [ ] **Step 3: Implement.**
  - Schema: add the table to both DDL places and add two `ALTER TABLE ... ADD COLUMN` statements to the idempotent ALTER tuple.
  - Blob path: `blob_root()/user_id/vault_id/sha256`; `user_id`/`vault_id` are sanitized with the same rule `account_purge` uses for the attachment dir, and `sha256` must match `^[0-9a-f]{64}$` or 400.
  - Stream: `stage_blob_stream` streams to `<final>.tmp-<uuid>`, hashing incrementally and counting bytes. It aborts with 413 the moment the count exceeds `MAX_BLOB_BYTES` or `remaining_bytes(user_id)`, and with 400 when the digest ≠ `sha256`. It deletes the tmp file on any failure, then `os.replace`s and upserts the row (`INSERT OR IGNORE`).
  - Bound checks: when `declared_length` is given, check it against both bounds and against `assert_import_headroom(declared_length)` BEFORE reading the stream. `NoteQuotaExceeded` maps to 503.
  - `remaining_bytes(user_id)` is `max(0, MEMBER_IMPORT_MEDIA_CAP_BYTES - SUM(size) over all vaults of user_id)`.
  - `gc_unreferenced` builds the referenced set from `json.loads(attachments_json)[*].sha256` over that vault's staging rows.
  - Purge: `revoke_devices` calls `purge_user(user_id)` inside its existing try, before deleting the devices. `account_purge` adds `"j2_obsidian_attachments"` to `_DIRECT_USER_TABLES` and removes `blob_root()/user_id` next to the attachment-tree removal.

- [ ] **Step 4: Run to verify they pass.** Run: `python -m pytest api/services/journal_two/test_obsidian_attachments.py api/services/journal_two/test_obsidian_link.py -q`. Expected: all PASS.

- [ ] **Step 5: Mutation-prove the two bounds.** Temporarily change the `>` in the running-count check to `>=` plus 10**9 (so the bound never fires), run the file, and confirm `test_over_max_bytes_aborts_mid_stream_with_413` FAILS. Revert by re-editing the file, never `git checkout` (see memory `feedback_mutation_check_never_git_checkout`). Do the same for the digest comparison.

- [ ] **Step 6: Commit.**
```bash
git add api/services/journal_two/note_connectors/obsidian_attachments.py api/services/journal_two/db.py api/services/journal_two/note_connectors/obsidian_link.py api/services/journal_two/account_purge.py api/services/journal_two/test_obsidian_attachments.py
git commit -m "feat(obsidian): staged attachment blob store, bounded and purged with the vault"
```

---

### Task 2: Server routes: version header, `/attachments/check`, `PUT /attachments/{sha}`, `attachments` on ingest

**Files:**
- Modify: `api/routers/note_sync.py` (`ObsidianNoteItem` ~l.1069, `obsidian_redeem` ~l.909, `obsidian_ingest` ~l.1153, new routes after it, `get_status` ~l.355)
- Modify: `api/services/journal_two/note_connectors/obsidian_staging.py` (`ingest_batch` signature, INSERT, final-branch GC)
- Modify: `api/services/journal_two/note_connectors/obsidian_link.py` (two new functions)
- Modify: `docs/feature_flags.json`
- Test: `api/services/journal_two/test_obsidian_ingest.py`

**Interfaces:**
- Consumes: Task 1's `stage_blob_stream`, `missing_hashes`, `remaining_bytes`, `MAX_BLOB_BYTES`, `BlobRejected`, `gc_unreferenced`.
- Produces:
  - `obsidian_link.record_plugin_version(device_id: str, raw: str | None) -> None`. It stores only values matching `^\d{1,4}\.\d{1,4}\.\d{1,4}$`, and is a no-op otherwise or when `raw` is None. **It never overwrites a stored version with NULL**: the redeem from an old plugin leaves it NULL, but nothing erases a known version.
  - `obsidian_link.plugin_versions_for_user(user_id) -> dict[str, str | None]`, keyed by `vault_id`.
  - `obsidian_staging.ingest_batch(..., notes)`, where each note dict may carry `"attachments": list[dict] | None`. It is stored as `attachments_json` (JSON text, or NULL when None). An unchanged `content_hash` stays a no-op exactly as today.
  - `/status`: each obsidian source dict gains `pluginVersion: str | None` and `pluginSupportsAttachments: bool`, which is version ≥ `OBSIDIAN_ATTACHMENTS_MIN_PLUGIN_VERSION = (0, 2, 0)`.
  - Flag helper `_obsidian_attachments_enabled() -> bool`, i.e. `os.environ.get("NOTE_SYNC_OBSIDIAN_ATTACHMENTS_ENABLED", "1") != "0"`.

- [ ] **Step 1: Write the failing tests** in `test_obsidian_ingest.py`. Reuse the `client` fixture and `_device_token`.

```python
_CHECK = "/api/j2/notes/connectors/obsidian/attachments/check"
def _put(sha): return f"/api/j2/notes/connectors/obsidian/attachments/{sha}"
H = lambda tok, v="0.2.0": {"Authorization": f"Bearer {tok}", "X-UCT-Plugin-Version": v}

def test_check_reports_protocol_limits_and_missing(client):
    tok = _device_token("user-a")
    r = client.post(_CHECK, json={"sha256": []}, headers=H(tok))
    assert r.status_code == 200 and r.json()["protocol"] == 1
    assert r.json()["maxBytes"] == 26214400 and r.json()["missing"] == []
    data = b"hello"; sha = hashlib.sha256(data).hexdigest()
    assert client.post(_CHECK, json={"sha256": [sha]}, headers=H(tok)).json()["missing"] == [sha]
    p = client.put(_put(sha), content=data, headers={**H(tok), "Content-Type": "image/png",
                                                      "X-UCT-Attachment-Name": "chart%20one.png"})
    assert p.status_code == 200 and p.json() == {"stored": True}
    assert client.post(_CHECK, json={"sha256": [sha]}, headers=H(tok)).json()["missing"] == []

def test_put_hash_mismatch_is_400_and_oversize_is_413(client, monkeypatch): ...
def test_attachment_routes_require_device_token_paid_plan_and_obsidian_flag(client, monkeypatch): ...
    # no bearer -> 401; user-free token -> 403; NOTE_SYNC_OBSIDIAN_ENABLED=0 -> 503
def test_attachments_flag_off_answers_404_like_an_old_server(client, monkeypatch):
    monkeypatch.setenv("NOTE_SYNC_OBSIDIAN_ATTACHMENTS_ENABLED", "0")
    assert client.post(_CHECK, json={"sha256": []}, headers=H(_device_token("user-a"))).status_code == 404
def test_cross_tenant_put_cannot_satisfy_another_users_check(client): ...
def test_ingest_stores_attachments_json_and_old_plugin_payload_stores_null(client):
    # new-plugin note with one ok ref -> staging row attachments_json parses to that list
    # 0.1.x-shaped note (no attachments key, no version header) -> attachments_json IS NULL
def test_ingest_rejects_malformed_attachment_refs_as_400(client): ...
    # bad status, sha256 not 64-hex, original > 2048 chars, > 5000 refs on one note -> 400, nothing staged
def test_plugin_version_recorded_on_redeem_and_ingest_never_erased(client):
    # redeem with header 0.2.0 -> /status pluginVersion "0.2.0", pluginSupportsAttachments True
    # later ingest WITHOUT header -> still "0.2.0"; garbage header "x; drop" -> unchanged
def test_status_reports_null_version_for_a_0_1_plugin(client): ...
def test_final_ingest_gcs_unreferenced_blobs(client, monkeypatch): ...  # monkeypatch older_than to 0
```

Fill each `...` with the assertions its name and comment state.

- [ ] **Step 2: Run to verify they fail.** Run: `python -m pytest api/services/journal_two/test_obsidian_ingest.py -q -k "attach or plugin_version or status_reports"`. Expected: FAIL (404 on the new routes, `KeyError: pluginVersion`).

- [ ] **Step 3: Implement.**
  - Gate order on both new routes is the same as `obsidian_ingest`: the attachments flag first (404), then `registry.get_entry("obsidian").configured()` (503), `_authenticate_obsidian_device` (401), `_require_paid_device_user` (403), and `record_plugin_version`.
  - The check route reads its JSON via `_read_bounded_body(request, 512_000)`.
  - The PUT route rejects `Content-Length > MAX_BLOB_BYTES` with 413 before reading, then passes `request.stream()` as `chunks` and maps `BlobRejected` to `HTTPException(e.status, e.detail)`. `X-UCT-Attachment-Name` is `unquote`d and limited to 255 chars with no `/` or `\`, otherwise 400. The declared MIME is the `Content-Type` header with parameters stripped.
  - The 413 detail for the member bound is exactly: `Your UCT storage for imported files is full. Free up space in the Notebook, then sync again.`
  - Add `ObsidianAttachmentRef` (`status: Literal[...]`, `Field` bounds per the protocol table) and `attachments: list[ObsidianAttachmentRef] | None = Field(default=None, max_length=5000)` to `ObsidianNoteItem`. Pass `n.model_dump()` through unchanged.
  - Call `record_plugin_version` in `obsidian_redeem` (after `redeem_connect_code`) and `obsidian_ingest`.
  - In `ingest_batch`, store `json.dumps(note.get("attachments"))` or NULL. In the `final and manifest` branch, call `obsidian_attachments.gc_unreferenced(user_id, vault_id)` after `commit()`; a GC failure is logged and never fails the push.
  - Ledger the flag in `docs/feature_flags.json` with status `armed`, default on, and these notes: `"0" makes both attachment routes 404 so every plugin falls back to text-only`, plus the re-arm command.

- [ ] **Step 4: Run to verify they pass.** Run: `python -m pytest api/services/journal_two/test_obsidian_ingest.py api/services/journal_two/test_obsidian_attachments.py -q`. Expected: all PASS, including the 38 pre-existing ingest tests unchanged.

- [ ] **Step 5: Commit.**
```bash
git add api/routers/note_sync.py api/services/journal_two/note_connectors/obsidian_staging.py api/services/journal_two/note_connectors/obsidian_link.py docs/feature_flags.json api/services/journal_two/test_obsidian_ingest.py
git commit -m "feat(obsidian): attachment check/upload routes, per-note attachment refs, plugin version on the device"
```

---

### Task 3: Provider: attachment refs become images, file chips and visible notices; `fetch_media` serves staged bytes

**Files:**
- Modify: `api/services/journal_two/note_connectors/providers/obsidian.py`: `_preprocess_obsidian_markdown` (~l.427), `_convert_row`/`_note_from_row` (~l.623-643), `fetch`/`fetch_many` SELECTs (add `attachments_json`), `fetch_media` (~l.698), plus a new `_promote_obsidian_placeholders`.
- Test: `api/services/journal_two/test_obsidian_provider.py`, `api/services/journal_two/test_obsidian_attachments_e2e.py` (new)

**Interfaces:**
- Consumes:
  - Task 1's `read_blob`.
  - Task 2's `attachments_json` and `plugin_versions_for_user` (the provider reads its own vault's version once per fetch call).
  - Plan A's `importNotice` node, **assumed block-level** (it replaces a hoisted `image` node in place); if plan A made it inline, wrap it in a paragraph at the same spot.
  - Plan A's engine media phase calling `normalize_media` and producing the I-7 marker on `NoteConnTransient`.
- **Before starting**, check the dependency: `git grep -n "normalize_media" api/services/journal_two/note_connectors/engine.py` must show a call inside `_upload_media_for_note`, and `git grep -n "importNotice" app/src` must show the node. If either is absent, STOP: plan A is not merged and this task must not duplicate it.
- Produces:
  - `_apply_attachment_refs(segment: str, refs: list[dict] | None, plugin_supports: bool) -> str`, a markdown→markdown pass run inside `_transform_outside_code` BEFORE `_transform_wiki_and_embeds`.
  - `_promote_obsidian_placeholders(converted: dict) -> dict`, run on `md_to_tiptap`'s output.
  - Reason codes written into `importNotice.attrs.reason`:
    - `obsidian-plugin-outdated`
    - `obsidian-attachments-unavailable`
    - `not-found`
    - `too-large`
    - `sync-off`
    - `storage-limit`

  If plan A's notice renderer has a closed vocabulary, add these with this exact copy; `{name}` is the attr:
    - outdated: `{name} wasn't synced. Update the UCT Notebook Sync plugin in Obsidian to bring images and files over.`
    - unavailable: `{name} wasn't synced yet. It will be retried on the next sync.`
    - not-found: `{name} wasn't found in the vault.`
    - too-large: `{name} is larger than 25 MB and wasn't copied.`
    - sync-off: `{name} wasn't synced because image and file sync is turned off in the plugin settings.`
    - storage-limit: `{name} wasn't copied: storage limit reached. It will be retried when space frees.`

  `name` carries the size for `too-large`, formatted as `video.mov (31.2 MB)`.

**Rewrite rules for `_apply_attachment_refs`.** These are exact. Replace each ref's `original` (exact substring, longest originals first, every occurrence) with:

| status | `embed` and image ext* | otherwise |
|---|---|---|
| `ok` | `![](<obsidian-att:{sha}/{q(name)}>)` | `![](<obsidian-file:{sha}/{q(name)}>)` |
| `too-large` / `missing` / `off` / `storage-limit` | `![](<obsidian-notice:{reason}/{q(name)}>)` | same |

\* Image extensions: `png jpg jpeg gif webp bmp svg heic heif tif tiff avif`. `name` = basename of `path`; `q` = `urllib.parse.quote(s, safe="")`. Reason map: `missing`→`not-found`, `off`→`sync-off`, the rest are themselves.

When `refs is None`, meaning the row came from a plugin that sent no list, every LOCAL reference with a non-`.md` extension in a wiki embed `![[x.ext…]]`, a wiki link `[[x.ext…]]`, a markdown image `![..](rel)` or a markdown link `[..](rel.ext)` (no URL scheme, not `#`) becomes `obsidian-notice:` with reason `obsidian-plugin-outdated` if the device version is below 0.2.0 or NULL, else `obsidian-attachments-unavailable`. Note links and `https://` refs are untouched, so plan A owns them.

`_promote_obsidian_placeholders` handles three placeholder kinds:
- `image` nodes whose src is `import-ref://obsidian-file:…` become `{"type": "attachmentChip", "attrs": {"href": src, "name": unquote(basename)}}`.
- `import-ref://obsidian-notice:{reason}/{q}` nodes become `{"type": "importNotice", "attrs": {"reason": reason, "name": unquote(q), "sourceUrl": None, "ref": None, "attempts": 0}}`.
- `obsidian-att:` image nodes stay images.

Media entries are handled in the same pass:
- `obsidian-notice:` entries are dropped.
- `obsidian-file:` entries get `kind="file"`.
- Every `obsidian-att:`/`obsidian-file:` entry gets `name=unquote(basename(ref))`.

Extract Dropbox's `_promote_md_attachments` tree walk into a shared `convert/placeholders.py::map_image_nodes(doc, fn)` helper and have both providers call it. Dropbox behaviour must be byte-identical; its tests prove that.

`fetch_media(ref)`:
- `obsidian-att:`/`obsidian-file:` → `read_blob(self.user_id, self.vault_id, sha)`, returning `(data, declared_mime or "application/octet-stream")`.
- A missing blob raises `errors.NoteConnTransient("attachment not staged yet", status=404)`, which takes the plan A I-7 retry path.
- `https:` → unchanged.
- Anything else → today's `NoteConnUnsupported`.

- [ ] **Step 1: Write the failing unit tests** in `test_obsidian_provider.py`.

```python
REF = lambda **k: {"original": "![[chart.png]]", "embed": True, "path": "attachments/chart.png",
                    "size": 10, "sha256": "a"*64, "status": "ok", **k}

def test_wiki_embed_with_ref_becomes_an_image_not_literal_text():
    conv = _convert("Above\n\n![[chart.png]]\n", refs=[REF()])
    img = _only(conv["doc"], "image")
    assert img["attrs"]["src"] == "import-ref://obsidian-att:" + "a"*64 + "/chart.png"
    assert "chart.png" not in _plain(conv["doc"])
    assert conv["media"] == [{"ref": "obsidian-att:" + "a"*64 + "/chart.png", "kind": "image", "name": "chart.png"}]

def test_width_suffix_and_markdown_image_relative_path_resolve_via_original(): ...
    # originals "![[chart.png|300]]" and "![](attachments/chart%20one.png)" -> both images
def test_pdf_embed_and_markdown_file_link_become_attachment_chips(): ...
    # "![[report.pdf]]" and "[report](report.pdf)" -> attachmentChip, media kind "file"
def test_each_non_ok_status_becomes_an_import_notice_with_the_right_reason(): ...
    # parametrize: too-large -> "too-large" (name "big.mov (31.2 MB)"), missing -> "not-found",
    # off -> "sync-off", storage-limit -> "storage-limit"; no media entry registered for any
def test_old_plugin_row_marks_local_attachments_outdated_and_leaves_note_links_and_urls():
    # refs=None, device version None: "![[x.png]]", "![](a/x.png)", "[f](f.pdf)" -> 3 notices reason
    # "obsidian-plugin-outdated"; "[[Other note]]" and "![](https://e.x/i.png)" untouched
def test_new_plugin_row_without_list_says_unavailable_not_outdated(): ...  # version "0.2.0", refs=None
def test_original_inside_code_is_not_rewritten(): ...  # "`![[chart.png]]`" stays code text
def test_attachment_names_round_trip_exactly():  # Review Focus 1
    for name in ["my chart #1 (v2).png", "Ünïcode.png", "100% done.png"]:
        conv = _convert(f"![[{name}]]", refs=[REF(original=f"![[{name}]]", path=f"att/{name}")])
        assert conv["media"][0]["name"] == name
async def test_fetch_media_serves_staged_blob_and_transient_when_missing(env): ...
def test_dropbox_attachment_promotion_unchanged(): ...  # run existing dropbox md-attachment test inputs through the shared helper
```

- [ ] **Step 2: Write the failing end-to-end test** `test_obsidian_attachments_e2e.py`. It drives the real HTTP routes, then `sync_engine.sync_source(source_id, full=True, manual=True)` (pattern: `test_obsidian_ingest.py:480-520`), with `_start_initial_sync` monkeypatched to a no-op.
  - Fixture bytes, committed under `api/services/journal_two/note_connectors/convert/obsidian_fixtures_in/bin/`: `chart.png` (a real 37x23 PNG generated once with Pillow and committed), `report.pdf` (a minimal valid PDF), `photo.heic` (copy plan A's HEIC fixture if one exists; otherwise skip that one case with `pytest.skip("plan A HEIC fixture absent")`).
  - `test_wiki_embed_png_lands_as_a_served_image_with_its_natural_size`: the stored note's image `src` is a UCT attachment URL (the `save_note_image_bytes` result `url`, not `import-ref://`), the bytes served for that attachment decode with Pillow to `(37, 23)`, and `import_media_pending` is 0.
  - `test_pdf_embed_lands_as_a_downloadable_chip_with_identical_bytes`: the chip `href` serves bytes whose sha256 equals `report.pdf`'s.
  - `test_heic_goes_through_plan_a_policy`: an image node exists and the stored mime is `image/jpeg`; this proves `normalize_media` ran.
  - `test_note_pushed_before_its_blob_heals_on_a_later_sync`: ingest the note first and sync; then PUT the blob and sync again (no note change); then the image is served. This proves the I-7 retry reaches staged blobs.
  - `test_old_plugin_payload_still_imports_text_with_outdated_notice`: a 0.1.x-shaped ingest with no header gives a note that exists with its text and has one `importNotice` with reason `obsidian-plugin-outdated`.

- [ ] **Step 3: Run to verify they fail.** Run: `python -m pytest api/services/journal_two/test_obsidian_provider.py api/services/journal_two/test_obsidian_attachments_e2e.py -q`. Expected: FAIL (literal `chart.png` text; `NoteConnUnsupported` from `fetch_media`).

- [ ] **Step 4: Implement** per the rules above. `_note_from_row` passes `json.loads(row["attachments_json"]) if row["attachments_json"] else None`.

- [ ] **Step 5: Run to verify they pass.** Run: `python -m pytest api/services/journal_two/test_obsidian_provider.py api/services/journal_two/test_obsidian_attachments_e2e.py api/services/journal_two/ -q -k "obsidian or dropbox"`. Expected: all PASS.

- [ ] **Step 6: Mutation-prove.** Delete the `longest originals first` sort and confirm that a test with originals `![[a.png]]` and `![[a.png|300]]` in one note goes red. Add that test to Step 1's list as `test_overlapping_originals_rewrite_longest_first` if it isn't there yet. Revert by edit.

- [ ] **Step 7: Commit.**
```bash
git add api/services/journal_two/note_connectors/providers/obsidian.py api/services/journal_two/note_connectors/providers/dropbox.py api/services/journal_two/note_connectors/convert/placeholders.py api/services/journal_two/note_connectors/convert/obsidian_fixtures_in/bin api/services/journal_two/test_obsidian_provider.py api/services/journal_two/test_obsidian_attachments_e2e.py
git commit -m "feat(obsidian): synced notes show their images and files; anything missing says so in the note"
```

---

### Task 4: Make the parity fixture realistic and add an attachment-names fixture

**Files:**
- Modify: `api/services/journal_two/note_connectors/convert/obsidian_fixtures_in/04-embed-image.vault.json`
- Create: `api/services/journal_two/note_connectors/convert/obsidian_fixtures_in/19-attachment-names.md`, `19-attachment-names.vault.json` (use the next free number if 19 is taken)
- Modify: `api/services/journal_two/note_connectors/convert/obsidian_parity_fixtures_gen.py`
- Regenerate: `app/src/pages/journal-2-0/lib/importer/__fixtures__/obsidian_parity/*.json`
- Test: `api/services/journal_two/test_obsidian_parity_fixtures.py`, `app/src/pages/journal-2-0/lib/importer/obsidianParity.contract.test.js`

**Interfaces:**
- Consumes: Task 3's `_apply_attachment_refs` through `_preprocess_obsidian_markdown`'s new `refs` parameter.
- Produces: sidecar schema `{vault_id, self_path, vault_paths, attachments?}`. `vault_paths` is the REAL vault listing (markdown and binaries), which is what the client drag-in lane sees. The server lane is given only `vault_paths` ending in `.md` as staging paths (production truth: staging never holds a binary path) plus `attachments` as the note's refs.

- [ ] **Step 1: Change the fixture first (the failing test).** Set `04-embed-image.vault.json` to `{"vault_id":"vault-1","self_path":"a.md","vault_paths":["a.md","files/chart.png"],"attachments":[{"original":"![[chart.png]]","embed":true,"path":"files/chart.png","size":1234,"sha256":"<64 hex of the string 'chart'>","status":"ok"}]}`. Add fixture 19 with `![[my chart #1 (v2).png]]`, `![](attachments/Ünïcode.png)` and `[the report](attachments/q3%20report.pdf)` plus matching `attachments` entries.

- [ ] **Step 2: Change the generator.**
  - The server lane uses `server_paths = [p for p in vault_paths if p.endswith(".md")]` and passes `refs=attachments`.
  - `_normalize_image_src` maps `obsidian-att:<sha>/<q>` and `obsidian-file:<sha>/<q>` to the `path` of the sidecar ref with that sha. It strips our own deterministic encoding; it does not percent-decode anything else.
  - The summary records `attachmentChip` names as a new `"files"` list in document order. Mirror that list in `obsidianParity.contract.test.js::walkSemantic`, reading the client lane's chip name.
  - Do NOT touch the href-decoding lines plan A is fixing (`_normalize_link_href`); if plan A has already landed, rebase onto it.

- [ ] **Step 3: Run to verify the rails go red, then regenerate.** Run: `python -m pytest api/services/journal_two/test_obsidian_parity_fixtures.py -q`. Expected: FAIL (committed JSON differs). Then run `python -m api.services.journal_two.note_connectors.convert.obsidian_parity_fixtures_gen` and inspect the diff of `04-embed-image.json`: `embeds` must equal `["files/chart.png"]` from BOTH lanes.

- [ ] **Step 4: Run both rails.** Run: `python -m pytest api/services/journal_two/test_obsidian_parity_fixtures.py -q` and `cd app && npx vitest run src/pages/journal-2-0/lib/importer/obsidianParity.contract.test.js`. Expected: PASS. If the client lane disagrees on fixture 19, that is a real client-lane defect (I-9, plan B's): mark the fixture case `knownClientDivergence` with a comment naming plan B's task; don't silently drop it.

- [ ] **Step 5: Commit.**
```bash
git add api/services/journal_two/note_connectors/convert/ app/src/pages/journal-2-0/lib/importer/__fixtures__/obsidian_parity/ app/src/pages/journal-2-0/lib/importer/obsidianParity.contract.test.js
git commit -m "test(obsidian): parity fixtures stage only markdown paths, like production, plus an attachment-names case"
```

---

### Task 5: Card tells a member on an old plugin that updating brings images; consent copy matches behaviour

**Files:**
- Modify: `app/src/pages/journal-2-0/hooks/useNoteConnectors.js` (`normalizeSource` ~l.112)
- Modify: `app/src/pages/journal-2-0/components/connectors/SourceRow.jsx` (after the `lastSyncError` line ~l.171)
- Modify: `app/src/pages/journal-2-0/components/connectors/ObsidianConnectModal.jsx` (docstring ~l.25-30, copy ~l.120-123)
- Test: `SourceRow.test.jsx`, `ObsidianConnectModal.test.jsx`

**Interfaces:**
- Consumes: Task 2's `/status` fields `pluginVersion`, `pluginSupportsAttachments`.
- Produces: `normalizeSource(raw).pluginVersion: string | null` and `.pluginSupportsAttachments: boolean | null`. The latter is `null` when the server predates the field, so an older server shows no hint.

- [ ] **Step 1: Write the failing tests.**

```jsx
it('tells a member on an old Obsidian plugin that updating brings images', () => {
  render(<SourceRow source={{ ...base, provider: 'obsidian', pluginVersion: null, pluginSupportsAttachments: false }} />)
  expect(screen.getByText(/Update UCT Notebook Sync in Obsidian to bring images and files over/)).toBeInTheDocument()
  expect(screen.getByText(/Settings, Community plugins, Check for updates/)).toBeInTheDocument()
})
it('shows no update hint for 0.2.0+, for other providers, or when the server sent no field', () => { ... })
// ObsidianConnectModal.test.jsx
it('consent copy says images and files your notes use are sent', () => {
  expect(screen.getByText(/and the images and files your notes use/)).toBeInTheDocument()
  expect(screen.queryByText(/does not upload attachments/)).toBeNull()
})
```

Exact hint copy: `Images and files from this vault aren't syncing yet. Update UCT Notebook Sync in Obsidian to bring images and files over (Settings, Community plugins, Check for updates).` It renders only when `provider === 'obsidian' && pluginSupportsAttachments === false`, in a `<p className={styles.conflictHint}>`.

New consent copy for the modal paragraph: `Once connected, the {label} plugin sends the markdown text of your notes, and the images and files your notes use, to your UCT Notebook. Nothing is ever written back to your vault.`

- [ ] **Step 2: Run to verify they fail.** Run: `cd app && npx vitest run src/pages/journal-2-0/components/connectors/SourceRow.test.jsx src/pages/journal-2-0/components/connectors/ObsidianConnectModal.test.jsx`. Expected: FAIL. Watch that the `-t` filter matches; a 0-test run is not a pass (memory `lesson_a_green_suite_can_hide_a_layout_regression`).

- [ ] **Step 3: Implement.** Use `pick(raw, 'pluginVersion', 'plugin_version', null)`, and the same for the boolean with fallback `null`.

- [ ] **Step 4: Run to verify they pass**, then run the whole `connectors/` directory: `npx vitest run src/pages/journal-2-0/components/connectors/`. Expected: all PASS.

- [ ] **Step 5: Commit, open the PR, ship the server.**
```bash
git add app/src/pages/journal-2-0/hooks/useNoteConnectors.js app/src/pages/journal-2-0/components/connectors/
git commit -m "feat(notebook): Obsidian card says updating the plugin brings images; consent copy matches"
git push -u origin feat/obsidian-attachments
gh pr create --title "Obsidian sync: attachments intake (server side of plugin 0.2.0)" --body "<summary + member impact + 'old plugins keep working text-only'>"
```
  Merge once green; the owner merges if the classifier blocks. Production deploy follows the standing GO. **The server ships before the plugin.** Verify the deploy with the commit present in `origin/production` and the Railway deploy `commitHash`, not by uptime. Against prod with an existing 0.1.4 vault (Task 11 Step 3), check that `POST .../attachments/check` answers 200 with `protocol: 1`.

---

### Task 6 (plugin repo): Reproducible-build groundwork

**Files** (standalone repo):
- Create: `.gitattributes` (`* text=auto eol=lf`), `.nvmrc` (the exact `node --version` used, e.g. `22.x.y`), `.github/workflows/build.yml`
- Modify: `package.json` (`devDependencies` pinned to the exact versions in `package-lock.json`, e.g. `"obsidian": "1.13.1"` instead of `"latest"`; add `"engines": {"node": "<same major>"}`)
- Modify: `src/test/obsidian-stub.ts` (add `export class TFile { path = ''; extension = ''; basename = ''; stat = { mtime: 0, size: 0, ctime: 0 }; }` and `export function parseLinktext(linktext: string) { const i = linktext.indexOf('#'); return i < 0 ? { path: linktext, subpath: '' } : { path: linktext.slice(0, i), subpath: linktext.slice(i) }; }`. This is the test stand-in for Obsidian's own; production uses the real one.)

**Interfaces:**
- Produces: `npm ci && npm run build` is deterministic, and the CI log prints `sha256sum main.js`.

- [ ] **Step 1: Renormalize line endings.** Run `git add --renormalize . && git status --short`. Expected: the CRLF working files (`README.md`, `manifest.json`, `package.json`, `src/batching.ts`, `hashing.ts`, `main.ts`, `settings.ts`) show as modified only in the index's view, with no content change in `git diff --cached --ignore-all-space`.
- [ ] **Step 2: Workflow.** On `push` (any branch, any tag) and `workflow_dispatch`, `build.yml` does `actions/checkout@v4`, `actions/setup-node@v4` with `node-version-file: .nvmrc`, then `npm ci`, `npm test`, `npm run build`, then `sha256sum main.js manifest.json styles.css`, then uploads `main.js` as a workflow artifact.
- [ ] **Step 3: Prove determinism locally.** Make two fresh `git clone` copies of the branch into two new scratchpad dirs. In each, run `npm ci && npm run build && sha256sum main.js`. Expected: identical hashes. The 0.1.4 sanity anchor: building tag `0.1.4` the same way must give `69c45bd9a0d43d878f943925ff49ec0fcddee0a489f75606b4759c29a5607cc0` (the published asset digest). If it does not, record why (e.g. a lockfile drift) before going further, because the review rebuild has the same problem.
- [ ] **Step 4: Run tests.** Run `npm test`. Expected: all existing suites PASS.
- [ ] **Step 5: Commit and push the branch.** Then check that the CI run's printed `main.js` sha equals Step 3's.
```bash
git add .gitattributes .nvmrc .github/workflows/build.yml package.json package-lock.json src/test/obsidian-stub.ts
git commit -m "build: pinned toolchain, LF sources, CI rebuild that prints the main.js digest"
git push -u origin feat/attachments-0.2.0
```

---

### Task 7 (plugin repo): Server URL validation with a clear message (§8)

**Files:**
- Create: `src/server-url.ts`; Test: `src/test/server-url.test.ts`
- Modify: `src/settings.ts` (Server URL setting), `src/main.ts` (`redeemConnectCode`, `runManualSync` guards)

**Interfaces:**
- Produces: `validateServerUrl(raw: string): { ok: true; url: string } | { ok: false; message: string }`. Valid input normalizes to the URL's origin with no trailing slash.

- [ ] **Step 1: Write the failing tests.**

```ts
it.each([
  ['https://uctintelligence.com', 'https://uctintelligence.com'],
  ['  https://uctintelligence.com/  ', 'https://uctintelligence.com'],
  ['uctintelligence.com', 'https://uctintelligence.com'],
  ['https://uctintelligence.com/journal?j2tab=notebook', 'https://uctintelligence.com'],
  ['http://localhost:8077', 'http://localhost:8077'],
  ['http://127.0.0.1:8000/', 'http://127.0.0.1:8000'],
])('accepts %s as %s', (raw, url) => expect(validateServerUrl(raw)).toEqual({ ok: true, url }));

it.each(['', 'not a url at all', 'ftp://uctintelligence.com', 'http://uctintelligence.com',
         'https://user:pw@uctintelligence.com', 'javascript:alert(1)'])('rejects %j with guidance', (raw) => {
  const r = validateServerUrl(raw);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toMatch(/https:\/\/uctintelligence\.com/);
});
```

Exact messages:
- empty → `Enter your UCT address, for example https://uctintelligence.com`
- unparseable/other scheme → `That isn't a web address. Use the address you open UCT at, for example https://uctintelligence.com`
- http on a non-local host → `Use https:// for this address, for example https://uctintelligence.com`
- credentials → `Remove the username and password from the address, for example https://uctintelligence.com`

- [ ] **Step 2: Run to verify they fail.** `npx vitest run src/test/server-url.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
  - Settings `onChange`: validate; when valid, save `url` and clear the setting's error line. When invalid, do not save, and render the message in a `<div class="uct-notebook-sync-error">` created once under that setting (use `setting.descEl.createDiv`; reuse the element across changes).
  - `main.ts`: `redeemConnectCode` and `runManualSync` validate `this.data.serverUrl` first. On failure they return or produce an error with message `Server URL is not valid: <message>` and make no network call.
- [ ] **Step 4: Run.** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat: validate the Server URL and say exactly what to type"` (stage the new files explicitly).

---

### Task 8 (plugin repo): Collect each note's attachment refs the way Obsidian resolves them

**Files:**
- Create: `src/attachment-refs.ts`; Test: `src/test/attachment-refs.test.ts`
- Modify: `src/vault-source.ts`, `src/hashing.ts`, `src/types.ts`; Test: `src/test/vault-source.test.ts`, `src/test/hashing.test.ts`

**Interfaces:**
- Produces (in `types.ts`):
  - `type AttachmentStatus = 'ok' | 'too-large' | 'missing' | 'off' | 'storage-limit'`
  - `interface NoteAttachmentRef { original: string; embed: boolean; path: string; size: number; sha256: string | null; status: AttachmentStatus }`
  - `NoteInput.attachments?: NoteAttachmentRef[]`
- Produces (in `attachment-refs.ts`):
  - `interface RawLinkRef { original: string; linkpath: string; embed: boolean }`
  - `interface ResolvedFile { path: string; extension: string; size: number; mtime: number }`
  - `classifyRef(raw: RawLinkRef, dest: ResolvedFile | null): { kind: 'skip' } | { kind: 'missing'; ref: NoteAttachmentRef } | { kind: 'file'; file: ResolvedFile; raw: RawLinkRef }`. A ref is **skipped** when `linkpath` has a URL scheme (`/^[a-z][a-z0-9+.-]*:/i`), is empty or `#…` only, when the dest's extension is `md`, or when it is unresolved and its extension is empty or `md`, because that is a note link and plan A's. It is **missing** when unresolved with a non-md extension.
  - `mimeForExtension(ext: string): string`, a fixed table covering png, jpg/jpeg, gif, webp, bmp, svg (`image/svg+xml`), heic, heif, tif/tiff, avif, pdf, mp4, mov (`video/quicktime`), mp3, m4a, wav, zip, docx, xlsx, pptx, csv, txt, canvas (`application/json`), with `application/octet-stream` otherwise.
  - `noteContentHash(body: string, refs: NoteAttachmentRef[] | null): string`. The algorithm is exact:
```ts
if (refs === null || refs.length === 0) return sha256Hex(body); // identical to 0.1.x: no re-push for notes without attachments
const canon = [...refs].sort((a, b) => a.original < b.original ? -1 : a.original > b.original ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  .map((r) => [r.original, r.embed, r.path, r.status, r.sha256 ?? '']);
return sha256Hex(body + '\u0000uct-attachments-v1\u0000' + JSON.stringify(canon));
```
- Produces (in `hashing.ts`): `sha256HexBytes(data: ArrayBuffer): string`. Widen the typed `Sha256Hasher.update` to `update(data: string | Uint8Array, inputEncoding?: 'utf8')`.
- Produces (`VaultSource`, extended in `sync-manager.ts`; implemented by `ObsidianVaultSource`):
  - `whenMetadataReady(timeoutMs: number): Promise<void>`. It resolves immediately if every markdown file has a non-null `getFileCache`; otherwise it waits for one `metadataCache` `'resolved'` event or the timeout, whichever is first, and unregisters the listener with `offref`.
  - `listRawRefs(notePath: string): RawLinkRef[]`. It reads `embeds` (`embed: true`) and `links` (`embed: false`) from `getFileCache`, dedupes by `original`, and returns `[]` when the cache is null.
  - `resolveLink(linkpath: string, sourcePath: string): ResolvedFile | null`. It applies Obsidian's `parseLinktext(linkpath).path` and then `metadataCache.getFirstLinkpathDest(path, sourcePath)`. If that is null and the path contains `%`, it retries once with `decodeURIComponent` (guarded by try/catch). It returns only an `instanceof TFile` dest.
  - `readBinary(path: string): Promise<ArrayBuffer>` via `vault.readBinary(file)`, with an `instanceof TFile` guard.
  - Do not reimplement shortest-path, same-folder-first or `attachmentFolderPath` logic: `getFirstLinkpathDest` is Obsidian's resolver.

- [ ] **Step 1: Write the failing tests.**
  - `attachment-refs.test.ts`:
    - `skips urls, anchors and note links; marks unresolved binaries missing`
    - `noteContentHash equals sha256Hex(body) for null and [] refs` (pins backward compatibility)
    - `noteContentHash changes when a ref's sha, status or path changes and not when ref order changes`
    - `mimeForExtension is case-insensitive`
  - `vault-source.test.ts` uses a fake `App`: `vault.getMarkdownFiles`, `getAbstractFileByPath` returning stub `TFile` instances, and `metadataCache` with `getFileCache`, `getFirstLinkpathDest`, `on`/`offref`, plus an emit helper.
    - `listRawRefs returns embeds and links from the cache with their exact original text`, using a fixture cache of `![[chart.png|300]]`, `![](attachments/x%20y.png)`, `[r](file.pdf)`, `[[Other note]]`.
    - `resolveLink delegates to getFirstLinkpathDest with the source path and strips #subpath`, asserting the fake was called with `('chart.png', 'Daily/2026-11-01.md')`.
    - `resolveLink retries percent-decoded once`
    - `waits for the metadata cache, then falls back to no refs`: one note's cache is null; `whenMetadataReady(50)` resolves after the fake emits `'resolved'`, and on timeout it still resolves; `listRawRefs` for the still-null note returns `[]` (Review Focus 5).
  - `hashing.test.ts`: `sha256HexBytes matches sha256Hex for the same UTF-8 bytes`.
- [ ] **Step 2: Run to verify they fail.** `npx vitest run src/test/attachment-refs.test.ts src/test/vault-source.test.ts src/test/hashing.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS, and tsc reports no `any` leaks.
- [ ] **Step 5: Commit.** `git commit -m "feat: collect the images and files each note uses via Obsidian's own link resolver"` (explicit `git add` of the files listed).

---

### Task 9 (plugin repo): Transport: check, upload, version header

**Files:**
- Modify: `src/api-client.ts`; Test: `src/test/api-client.test.ts`

**Interfaces:**
- Consumes: the wire protocol above; `manifest.json` version, read at build time via `import manifest from '../manifest.json'` (esbuild inlines JSON; add `"resolveJsonModule": true` to tsconfig) as `PLUGIN_VERSION`.
- Produces:
  - `CheckOutcome = { ok: true; supported: false } | { ok: true; supported: true; missing: string[]; maxBytes: number; remainingBytes: number } | { ok: false; status: number; message: string; authExpired: boolean }`
  - `UploadOutcome = { ok: true; stored: boolean } | { ok: false; status: number; message: string; authExpired: boolean; storageFull: boolean }`
  - On `Transport`: `checkAttachments(params: { serverUrl: string; token: string; sha256: string[] }): Promise<CheckOutcome>` and `uploadAttachment(params: { serverUrl: string; token: string; sha256: string; name: string; mime: string; data: ArrayBuffer }): Promise<UploadOutcome>`.
  - Every request, `redeem` and `ingest` included, sends `X-UCT-Plugin-Version: PLUGIN_VERSION`.
  - `supported: false` is returned for HTTP 404 or 405, or for a 2xx whose JSON `protocol` is not the number `1`. This covers older servers, the flag-off kill switch, and an SPA fallback page.
  - `storageFull` is `status === 413 && /storage/i.test(message)`. A 413 for an over-size file sets `storageFull: false`.
  - `uploadAttachment` uses `requestUrl({ method: 'PUT', body: data, contentType: mime, headers: { Authorization, 'X-UCT-Plugin-Version', 'X-UCT-Attachment-Name': encodeURIComponent(name) }, throw: false })`. A thrown network error becomes `{ ok: false, status: 0, message, authExpired: false, storageFull: false }`, and the same holds for `checkAttachments`.

- [ ] **Step 1: Write the failing tests** against the stubbed `requestUrl`:
  - `sends the plugin version header on redeem, ingest, check and upload`
  - `check: 404 and 405 and a protocol-less 200 mean unsupported`
  - `check: 200 returns missing and limits`
  - `upload: PUT with raw ArrayBuffer body, declared mime and encoded name`
  - `upload: 413 storage message sets storageFull, 413 size does not`
  - `401 sets authExpired on both`
  - `a thrown network error is an outcome, never an exception`
- [ ] **Step 2: Run to verify they fail.** `npx vitest run src/test/api-client.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Extend the `FakeTransport` in `sync-manager.test.ts` with scripted `checkAttachments`/`uploadAttachment` queues; default them to `{ ok: true, supported: false }` so the existing tests keep passing unchanged.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: attachment check/upload transport and a plugin version header on every request"`.

---

### Task 10 (plugin repo): Sync with attachments: phase 0, legacy mode, re-send once, settings

**Files:**
- Create: `src/attachment-sync.ts`; Test: `src/test/attachment-sync.test.ts`
- Modify: `src/sync-manager.ts` (`runSync` scan loop ~l.104-115, summary), `src/sync-plan.ts` (`toNoteInput` carries `attachments`), `src/batching.ts` (overhead counts `JSON.stringify(note.attachments ?? [])` UTF-8 bytes), `src/types.ts` (`ScannedFile.attachments: NoteAttachmentRef[] | null`, `PluginData` additions), `src/main.ts` (summary text, one-time notice), `src/settings.ts` (toggle + issues list)
- Test: `src/test/sync-manager.test.ts`, `src/test/batching.test.ts`

**Interfaces:**
- Consumes: Task 8's `classifyRef`, `noteContentHash`, `mimeForExtension`, `sha256HexBytes`, and the `VaultSource` additions; Task 9's `checkAttachments`/`uploadAttachment`.
- Produces:
  - `PluginData` gains:
    - `syncAttachments: boolean` (default `true`)
    - `attachmentHashes: Record<string, { mtime: number; size: number; sha256: string }>` (default `{}`; entries GC'd when the path is no longer referenced)
    - `attachmentIssues: { path: string; reason: 'too-large' | 'missing' | 'storage-limit' | 'upload-failed'; size: number }[]` (default `[]`, replaced each run)
    - `attachmentsNoticeShown: boolean` (default `false`)
  - `loadPluginData`'s spread of defaults supplies them on upgrade.
  - `SyncSummary` gains `attachmentsSent: number` and `attachmentIssues: number`.
  - `prepareAttachments(deps: { transport; vaultSource; data: PluginData; serverUrl; token }, notePaths: string[]): Promise<{ supported: boolean; refsByNote: Map<string, NoteAttachmentRef[] | null>; sent: number; issues: PluginData['attachmentIssues']; authExpired: boolean; failMessage?: string }>`, in `attachment-sync.ts`.

**Algorithm of `prepareAttachments`.** Exact order; this is the part the tests pin.
1. `checkAttachments(sha256: [])`. A 401 returns `authExpired` (the caller runs the existing `fail(..., true)`). A non-2xx/network failure, or `supported: false`, maps every note to `null`, meaning legacy (no `attachments` field, 0.1.x hash), and returns `supported: false`.
2. `await vaultSource.whenMetadataReady(15000)`.
3. For each note path, `listRawRefs` then `resolveLink(linkpath, notePath)` then `classifyRef`.
   - If `!data.syncAttachments`, every resolved file becomes `status: 'off'`, `sha256: null`.
   - Else if `size > maxBytes`, it becomes `too-large`.
   - Else its sha256 comes from `attachmentHashes[path]` when `mtime` and `size` match, otherwise it is computed via `readBinary` + `sha256HexBytes` and the cache is updated.
4. `checkAttachments` over the unique `ok` hashes of **all notes in the vault**, not only changed ones, chunked by 1000. Because the check covers all notes, a blob that failed last run is retried even though its note didn't change.
5. Upload each missing hash once, sequentially, for the first path that has it. Before each upload, if `size > remainingBytes`, mark every ref with that hash `storage-limit` and skip without uploading. Otherwise decrement `remainingBytes` on success.
   - On `storageFull`, mark this and all remaining missing hashes `storage-limit` and stop uploading.
   - On any other failure, the ref keeps `ok` (the server shows "retrying", via plan A I-7), record `upload-failed`, and continue with the next.
   - On a 401, return `authExpired`.
6. Issues: `too-large`, `missing`, `storage-limit` and `upload-failed`, each with its path and size.

`runSync` changes:
- Call `prepareAttachments` after `listMarkdownFiles` and before hashing.
- Then `ScannedFile.hash = noteContentHash(body, refsByNote.get(path) ?? null)` and `ScannedFile.attachments = refs`.
- `toNoteInput` includes `attachments` only when non-null.
- Everything after that (planSync, batching, the two-phase push, finalizeManifest) is unchanged.
- An attachment failure never fails the run; only `authExpired` does.

- [ ] **Step 1: Write the failing tests** in `sync-manager.test.ts` and `attachment-sync.test.ts`. The fake `VaultSource` gains refs, resolution and binary maps; `FakeTransport` gets scripted check/upload.

```ts
it('uploads a referenced image once, then pushes the note with its ref and an attachment-aware hash', async () => {
  // vault: 'a.md' = '![[chart.png]]', binary 'att/chart.png' (bytes B)
  // check([]) -> supported, maxBytes 26214400; check([sha(B)]) -> missing [sha(B)]; upload -> stored
  const s = await mgr.runSync();
  expect(t.uploadCalls.map((u) => u.sha256)).toEqual([sha(B)]);
  const note = t.ingestCalls[0]!.notes[0]!;
  expect(note.attachments).toEqual([{ original: '![[chart.png]]', embed: true, path: 'att/chart.png', size: B.byteLength, sha256: sha(B), status: 'ok' }]);
  expect(note.content_hash).toBe(noteContentHash('![[chart.png]]', note.attachments!));
  expect(s.attachmentsSent).toBe(1);
});
it('dedupes uploads by content hash across notes and renames', ...);            // Review Focus 2
  // two notes embed the same bytes under two paths -> one upload; then rename the binary (same bytes) ->
  // run 2 uploads nothing (check says not missing) and re-pushes both notes once (path in hash), run 3 pushes nothing
it('legacy server keeps 0.1.x hashes, then re-sends attachment notes once after server upgrade', ...); // Review Focus 3
  // run 1: check -> supported:false; no uploads; note hashes == sha256Hex(body); no attachments key on the wire
  // run 2 (server upgraded): only the note with a ref is re-pushed; the plain note is not; run 3: nothing re-pushed
it('an upload failure never blocks notes and the next run uploads only what is missing', ...);        // Review Focus 4
  // 3 blobs, 2nd upload returns status 0; run 1 ok, notes pushed, issues has 1 'upload-failed'
  // run 2: no note changed; check says only blob 2 missing; exactly 1 upload; issues []
it('a note indexed late re-pushes once with its attachments', ...);                                    // Review Focus 5
  // run 1: cache null for a.md -> refs [] -> legacy hash; run 2: cache present -> pushed again with refs; run 3: nothing
it('too-large, missing and storage-limit refs are sent with their status and never uploaded', ...);
it('a 413 storage-full stops further uploads in the run', ...);
it('turning attachment sync off sends status off and uploads nothing; turning it back on re-sends', ...);
it('a 401 on check or upload clears the token and reports needsReconnect', ...);
it('attachment hash cache: unchanged mtime+size never re-reads the binary', ...);  // readBinary call count
it('the manifest never names an attachment path', ...);  // final manifest == markdown paths only
// batching.test.ts
it('counts attachment refs toward the batch byte budget', ...);
```

- [ ] **Step 2: Run to verify they fail.** `npx vitest run src/test/sync-manager.test.ts src/test/attachment-sync.test.ts src/test/batching.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `attachment-sync.ts` and the `runSync`/plan/batching changes** per the algorithm above.
- [ ] **Step 4: Settings and notices** (no new test file; covered by the manual E2E in Task 11 and by review rules).
  - `settings.ts` gets `new Setting(containerEl).setName('Sync images and files').setDesc('Send the images and files your notes use (up to 25 MB each). Turn off to send note text only.').addToggle(...)`, saving `data.syncAttachments`.
  - When `attachmentIssues.length > 0`: `new Setting(containerEl).setName(`Images and files that could not sync (${n})`).setHeading()`, then one `createEl('li')` per issue reading `<path>: <reason text>`. The reason texts are `larger than 25 MB`, `not found in this vault`, `UCT storage is full`, and `upload failed, will retry on the next sync`.
  - `main.ts` `summarize()` appends `${n} image/file(s) sent` and `${m} could not be sent (see Settings)`.
  - On the first successful run with `supported && syncAttachments && !attachmentsNoticeShown`, show `new Notice('UCT Notebook Sync now also sends the images and files your notes use. You can turn this off in its settings.')` and set the flag.
  - The headings contain no plugin name, and no command id changes.
- [ ] **Step 5: Run** `npm test && npm run build`. Expected: all PASS and tsc clean. Mutation-prove Review Focus 4: make step 4 of the algorithm check only changed notes' hashes, confirm `an upload failure never blocks notes…` goes red, and revert by edit.
- [ ] **Step 6: Commit.** `git commit -m "feat: sync the images and files notes use; old servers keep working text-only"` (explicit `git add`).

---

### Task 11: Release 0.2.0: build, production E2E, tag, publish, listing

**Files** (standalone repo): `manifest.json`, `package.json`, `package-lock.json` (version field), `versions.json`, `README.md`. In the monorepo: replace `obsidian-plugin/` contents with a one-file `obsidian-plugin/README.md` pointer, and amend `docs/notebook-connectors/60-user-reliability-certification.md` §11 item 5 plus an I-8 addendum.

**Interfaces:**
- Consumes: Tasks 1-10 merged; the server deployed to production (Task 5 Step 5).
- Produces: GitHub release `0.2.0` whose `main.js` sha256 equals `E2E_SHA`, recorded in this plan's execution log and in the PR body.

- [ ] **Step 1: Version bump and docs.** Set `version` to `0.2.0` in `manifest.json` and `package.json` (run `npm install --package-lock-only` to sync the lock) and add `"0.2.0": "1.5.0"` to `versions.json`. In the README:
  - Replace the "No attachment/image upload" bullet with how attachments work: 25 MB cap, dedupe, what is shown when something can't come over, and the toggle.
  - Update the privacy paragraph: it now sends the images and files notes use.
  - Note that older servers fall back to text-only.

  Commit `0.2.0: images and files your notes use now sync`, then push the branch, open a PR in the plugin repo, wait for CI green, and merge to `main`. Record the merge commit as `REL`.
- [ ] **Step 2: Build the candidate from a clean checkout of `REL`.** `git clone` the repo into a new empty scratchpad dir `obs-rel-0.2.0`, run `git checkout REL && npm ci && npm test && npm run build && sha256sum main.js`, and record the result as `E2E_SHA`. A second clean clone must give the same digest, and so must the CI run on `REL` (read its log). Any mismatch: stop and fix determinism first.
- [ ] **Step 3: Compatibility leg: 0.1.4 against the NEW production server.**
  1. Prepare the test vault: a new vault directory in the scratchpad, `uct-e2e-vault-0.2.0`, never the owner's `OneDrive/Documents/Obsidian Vault`. It contains:
     - `.obsidian/app.json` = `{"attachmentFolderPath":"attachments","newLinkFormat":"shortest"}`
     - notes:
       - `Embed wiki.md`: `![[chart one.png]]` and `![[chart one.png|300]]`
       - `Embed md.md`: `![](attachments/chart%20one.png)`
       - `Files.md`: `![[q3 report.pdf]]` and `[the report](attachments/q3%20report.pdf)`
       - `Shared.md`: `![[chart one.png]]`
       - `Missing.md`: `![[nope.png]]`
       - `Big.md`: `![[big.bin]]`, where `big.bin` is 26 MB of random bytes
       - `Sub/Local.md`: `![[dup.png]]`, with a different `Sub/dup.png` and `attachments/dup.png`
       - `Plain.md`: text only
     - `attachments/chart one.png`, a real PNG of known size, e.g. 37x23.
  2. Install the published 0.1.4 assets (`gh release download 0.1.4`) into `.obsidian/plugins/uct-notebook-sync/` and enable the plugin in `.obsidian/community-plugins.json`.
  3. Launch Obsidian. If an Obsidian window is open (`tasklist | findstr Obsidian`), stop and tell the owner to close Obsidian; never kill the owner's instance. Launch `C:/Users/Patrick/AppData/Local/Programs/Obsidian/Obsidian.exe --remote-debugging-port=9333`, open the test vault, and drive everything over CDP with no OS keystrokes (memory `lesson_an_os_key_goes_to_the_foreground_window`).
  4. Mint a connect code from production using the persistent rig Chrome profile session (`.worktrees/canary-chrome-profile-persistent`; read `tools/window_check.py`'s latest row first, because no sign-in is needed while `/api/auth/me` is 200). Call `POST /api/j2/notes/connectors/obsidian/connect {"consent":true}`.
  5. In Obsidian via CDP: `await app.plugins.plugins['uct-notebook-sync'].redeemConnectCode(code)` (0.1.4's connect also syncs; otherwise call `runManualSync()`).
  6. Verify via the prod API:
     - all 8 notes exist with their text;
     - `Embed wiki` has an `importNotice` with reason `obsidian-plugin-outdated`;
     - `/status` shows `pluginVersion: null` for the source;
     - the Notebook card in the rig Chrome shows the update hint.
- [ ] **Step 4: Upgrade leg: replace the plugin files in the SAME vault with Step 2's three files** (verify `sha256sum main.js == E2E_SHA`). Reload the plugin via CDP (`app.plugins.disablePlugin` then `enablePlugin`) and run `runManualSync()`. Then verify via the prod API and the rendered Notebook in the rig Chrome:
  - **(a)** No duplicate notes; note count unchanged.
  - **(b)** `Embed wiki`, `Embed md` and `Shared` show `<img>` whose `naturalWidth x naturalHeight` == 37x23, and whose served bytes' sha256 equals the local file's.
  - **(c)** `Files` has two chips whose `href` downloads bytes with the local pdf's sha256.
  - **(d)** `Missing` shows the `not-found` notice; `Big` shows `too-large` with `big.bin (26.0 MB)`; and `Sub/Local` shows the content of `Sub/dup.png`, meaning Obsidian's same-folder resolution was honoured (compare sha).
  - **(e)** `Plain` was not re-pushed: its staging `received_at` is unchanged. Read this via the plugin summary `pushed` count = number of notes with refs.
  - **(f)** `/status` `pluginVersion` is `"0.2.0"` and the card hint is gone.
  - **(g)** A second `runManualSync()` pushes 0 notes and uploads 0 files.
  - **(h)** The Server URL field rejects `http://uctintelligence.com` with the Task 7 message and keeps the old value.
- [ ] **Step 5: Clean up the production residue.**
  1. Disconnect the vault from the dashboard (`DELETE /api/j2/notes/connectors/obsidian`); `revoke_devices` purges staging and blobs.
  2. Delete the test notes and their destination folder via the API, and confirm the Notebook's note count is back to its pre-test value (record it before Step 3).
  3. Close the Obsidian instance you launched: by its PID, captured at launch.
  4. Delete the scratch vault.
- [ ] **Step 6: Tag and publish exactly the E2E binary.**
```bash
cd <obs-rel-0.2.0 clean clone>
git tag 0.2.0 REL && git push origin 0.2.0
gh release create 0.2.0 main.js manifest.json styles.css --title "0.2.0" --notes "Images and files your notes use now sync to UCT Notebook (up to 25 MB each). Anything that can't come over is marked in the note. Turn it off in the plugin settings to send text only."
gh release view 0.2.0 --json assets --jq '.assets[] | select(.name=="main.js") | .digest'
```
  Expected: `sha256:<E2E_SHA>`. If it differs, delete the release (not the tag) and re-upload from the clean clone.
- [ ] **Step 7: OWNER CLICK: listing update.** Ask the owner, in one message:
  > Open https://community.obsidian.md, sign in, open the developer dashboard, choose **UCT Notebook Sync**, and click **Check for new releases**. Tell me what the review result says, or paste its text.

  If review flags an error: fix it, bump to `0.2.1` (`versions.json` keeps every entry), repeat Steps 2-6 (Step 3 can be skipped if only plugin-side copy/lint changed; Step 4 is never skipped), and ask for the click again.
- [ ] **Step 8: Prove the listed binary is the tested one.** Once the directory shows 0.2.0 (up to 24 h), create a fresh scratch vault, open Obsidian's Community plugins browser via CDP and use **Check for updates** / **Install**. Assert `sha256sum .obsidian/plugins/uct-notebook-sync/main.js == E2E_SHA`. If the CDP drive of the in-app browser is not possible, use `curl -L https://github.com/unchartedterritory5995-cyber/obsidian-uct-notebook-sync/releases/latest/download/main.js | sha256sum`, which is the URL Obsidian's installer reads. Remove the scratch vault.
- [ ] **Step 9: Monorepo pointer and certification addendum.**
  - Replace `obsidian-plugin/` with a single `obsidian-plugin/README.md`: `The Obsidian plugin lives in https://github.com/unchartedterritory5995-cyber/obsidian-uct-notebook-sync (published to Obsidian's community directory). This directory held a pre-publication 0.1.0 snapshot and was removed on 2026-11-01 so there is one copy.`
  - Certification §11 item 5 gets: `CLOSED in plugin 0.2.0: the Server URL is validated with a clear message`.
  - Add an I-8 addendum with the Step 4 evidence (the 8 assertions, `E2E_SHA`, the release digest).
  - Commit on the monorepo branch, open a PR, and merge per standing GO.
```bash
git rm -r obsidian-plugin && mkdir obsidian-plugin && <write README> && git add obsidian-plugin docs/notebook-connectors/60-user-reliability-certification.md
git commit -m "docs: one copy of the Obsidian plugin; certify 0.2.0 attachment sync"
```

---

## Self-review (done)

- **Spec coverage:** every I-8 requirement maps to a task.
  - Plugin uploads referenced binaries: Tasks 8 and 10.
  - Resolved the way Obsidian resolves (via `getFirstLinkpathDest`): Task 8.
  - Dedupe by hash: Task 10 (RF2).
  - Size cap: Tasks 1, 2 and 10.
  - Staged-push protocol extended: Task 2.
  - Release (bare tag, reproducible build, listing): Tasks 6 and 11.
  - Old plugins keep working and the member is told: Tasks 3 and 5.
  - §9 re-send once: the `noteContentHash` design (Tasks 8 and 10, RF3).
  - §8 Server URL: Task 7.
  - §15 Q2 storage-limit marker and retry when space frees: Tasks 1, 3 and 10.
  - §4 "nothing silently dropped": notices for every non-ok status (Task 3).
  - Fixture realism: Task 4.
  - I-5/I-1/I-2 media conversion: plan A, consumed via the media phase and proven by Task 3's HEIC e2e.
- **Type consistency:**
  - `NoteAttachmentRef` and `ObsidianAttachmentRef` share field names.
  - `prepareAttachments`, `noteContentHash`, `classifyRef`, `checkAttachments` and `uploadAttachment` are used under the names defined in Tasks 8 and 9.
  - The ref schemes `obsidian-att:`, `obsidian-file:` and `obsidian-notice:` are identical in Tasks 3 and 4.
- **Review Focus:** all five are pinned to named tests in Tasks 3, 8 and 10.
- **Known non-goals left:**
  - The `|300` width is not applied (§5.6 polish).
  - The markdown link text of `[the report](file.pdf)` becomes the chip's file name, not "the report" (same as Dropbox today).
  - A single note whose JSON (body plus refs) alone exceeds the 2 MB ingest cap still fails its batch, as body-only notes already can today.
