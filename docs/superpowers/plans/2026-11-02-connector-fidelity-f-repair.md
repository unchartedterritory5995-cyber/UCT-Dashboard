# Plan F: Repair of Already-Imported Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-time, per-member, resumable repair that fixes the known-broken link and image shapes in notes members imported before Plans A and B, never touching a note edited since import, dry run first.

**Architecture:** Three pure layers over a stored TipTap body (shape detectors, link repair, media repair) reuse the live converters (`linkify.linkify_doc`, `link_keys.resolve_link_keys`, `rewrite_body`, the Obsidian vault index, `import_notice.notice_node`). A runner streams one member and one note at a time from `auth.db`, decides hands-off with the ONE predicate, and writes only through `engine._apply_resolved_body` (timestamp-neutral, optimistic-locked, sidecars rebuilt). A CLI on the web pod runs it read-only by default; `--apply` needs an env flag. A small member notice points members with detectable losses at Plan B's live "Re-import to recover" flow.

**Tech Stack:** Python 3 / FastAPI / SQLite (`auth.db`), pytest; React + Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-11-01-connector-fidelity-and-evernote-design.md` (§9, §15 Q1; context §5, §11, §12). Program state: `docs/notebook-connectors/RESUME-connector-fidelity.md`.

## What is already live, and what that leaves for Plan F (verified on `origin/master` `6272ed7fa3`, 2026-11-02)

- **Plan A is live** (`#650` 2026-11-01 22:03 CT, `#669`/`#677` 2026-11-02 06:46 CT): the remote-revision gate (`engine._remote_changed` on `import_remote_rev`), timestamp-neutral engine writes (`_apply_resolved_body`, `_write_*_preserving_updated_at`), the ONE predicate `import_provenance.edited_since_import` (+ `legacy_finalize_shape`, `LEGACY_FINALIZE_CUTOFF = "2026-11-02T00:00:00+00:00"`), `media_policy`, `POST /api/j2/notes/media/fetch`, `POST /api/j2/notes/import/heal-links` (`link_keys.heal_pending_links`), `convert/linkify.py` (`linkify_doc`, `finalize_links`), the `importNotice` node. **Plan B is live** (`#678` 06:47 CT, `#685` 09:16 CT): `import_confirm(..., guard_edits=True)`, `mode: "recover"`, `notes._edited_since_file_import`, the `imported_at` stamp on the finalize PUT, the wizard's "Re-import to recover missing pictures and links" checkbox. **Plan D is live** (`#642`). **Plan C is NOT merged** (no Obsidian attachment intake on master). `requirements.txt` already carries `linkify-it-py`, `pi-heif`, `Pillow>=11.3.0`.
- **What the nightly re-convert covers.** The hash `import_confirm` compares is over OUR converted placeholder body, so a converter change moves it; an UNEDITED connector note then goes to `import_confirm` and is rewritten with the new converter (edited ones are skipped by the gate, `engine.py:2270-2300`). But only for notes the pass actually re-lists: `cursor = None if (full and present_fn is None) else source.get("cursor")` (`engine.py:607`). So:
  - **Notion, Roam, Craft** (and Dropbox/OneDrive, not activated): the 01:47 ET full pass re-lists everything ⇒ every unedited note whose remote is still reachable is re-converted. **The first such pass after the converter merge is 2026-11-03 01:47 ET** (the 11-02 pass ran before `#669`/`#677` merged at 06:46 CT). Plan F does NOTHING to these notes while their source is active; it only counts what is left.
  - **Obsidian (connector)** defines `list_present_refs`, so the full pass keeps the stored cursor and re-lists only rows re-pushed since: **unchanged Obsidian notes are never re-converted by the nightly pass.** Their markdown is still in `j2_obsidian_staging` (nothing deletes staging rows), so Plan F re-lists them by resetting that source's cursor to NULL (the provider's documented "everything staged so far"); the engine then re-converts them through its normal path. Images still need Plan C's plugin re-send (out of scope here).
  - **OneNote** also keeps its cursor (bounded drain); not activated in production; out of scope.
  - **File imports** (.enex, Notion zip, Obsidian zip, generic, Keep, Logseq, UCT export) have no source: nothing ever re-converts them. **This is Plan F's main body of work.**
  - **Connector notes whose source is gone** (no active source of that provider for the member): nothing re-converts them either; Plan F gives them the link-only repairs.
- **Legacy rows have `import_links_pending` NULL** (the column was added with no backfill, `db.py:2124`), so the live heal sweep never reaches a pre-Plan-A note holding a stranded `import-link://`. Plan F's write recomputes it.

## Global Constraints

- Never write a note the member edited since import. The test is `import_provenance.edited_since_import(updated_at, imported_at)`, called in ONE place (`runner.hands_off`). Never a second definition.
- Ruling: Plan F does NOT apply Plan B's `legacy_finalize_shape` carve-out. That carve-out has an accepted residual (an image-only member edit inside the window reads as unedited); a member-requested recover can carry it, an unrequested background repair cannot. Notes it would admit are counted (`legacy_finalize`) and left to the member notice and the recover flow.
- Timestamp-neutral: every note write goes through `engine._apply_resolved_body(conn, user_id, note_id, body, expected_updated_at=row.updated_at)`. `updated_at`, `imported_at`, `import_hash`, `import_remote_rev` and `j2_note_versions` never change.
- Dry run is the default and opens `auth.db` with `file:<path>?mode=ro`. The production run happens only after the owner reviews the dry-run numbers.
- No DELETE statement anywhere in `api/services/journal_two/import_repair/` or `tools/note_import_repair.py` (railed by a source scan).
- Kill switch = env var `NOTE_IMPORT_REPAIR_ENABLED` (default off; `--apply` refuses without `=1`). Never a delete of member data.
- Reuse, never fork: `linkify_doc`, `resolve_link_keys`, `link_keys._media_passthrough`, `rewrite_body`, `obsidian._build_basename_map` / `resolve_pending_target`, `import_notice.notice_node`, `media_policy.normalize_media` / `store_media`, `fetch_content_url`.
- Member content never leaves production: no local DB copy; reports carry ids and counts only, never titles or text.
- New notice copy lives in BOTH copy tables (`import_notice.NOTICE_COPY`, `importNoticeText.js` `NOTICE_COPY`), pinned by `tests/test_import_notice.py`.
- New gate `NOTE_IMPORT_REPAIR_ENABLED` gets a `docs/feature_flags.json` entry, status `pending` (`tests/test_feature_flag_ledger.py`).
- No `requirements.txt` change.
- PC load: one implementer at a time, focused test files only.

## Review Focus

1. **A member edits a note between the scan and the write.** Expected: the member's edit stands; the note is logged `race_lost`. Owner: Task 7 (`test_a_note_edited_after_planning_is_not_overwritten`).
2. **Text that looks like a link but isn't** (`NVDA.US`, `BRK.B`, a URL inside a code mark or code block). Expected: never linkified. Owner: Task 3 (`test_linkify_obeys_the_live_allow_list`).
3. **A relative link whose name matches two notes** (duplicate basenames in a vault, two Notion pages with the same stripped name). Expected: Obsidian's own order (same folder, then shortest path); a Notion name with no unique key becomes plain text, never a guess. Owner: Task 3 (`test_ambiguous_relative_targets`).
4. **A member with thousands of imported notes, or one huge body.** Expected: one body in memory at a time; a body over `MAX_SCAN_BODY_BYTES` is skipped and counted `too_large_to_scan`, never parsed. Owner: Task 6 (`test_huge_body_is_counted_not_parsed`).
5. **The pod restarts mid-run.** Expected: re-running with the same `--run-id` skips finished members, and the half-done member's already-repaired notes come out `unchanged`. Owner: Task 7 (`test_resume_after_interruption`).

---

## File Structure

| File | Responsibility |
|---|---|
| `api/services/journal_two/import_repair/__init__.py` | package marker, `NOTE_CLASSES` |
| `api/services/journal_two/import_repair/shapes.py` | pure detectors: which broken shapes a stored body carries |
| `api/services/journal_two/import_repair/links.py` | pure-ish link repair (relative hrefs, `%xx` keys, linkify, key resolution) |
| `api/services/journal_two/import_repair/media.py` | missing-media notices, hotlink listing and src replacement |
| `api/services/journal_two/import_repair/store.py` | progress, per-note log and notice tables |
| `api/services/journal_two/import_repair/runner.py` | selection, classification, the hands-off guard, scan (dry run) and apply |
| `api/services/journal_two/hotlink_fetch.py` | download + normalize + store one hotlinked image (extracted from the route) |
| `api/services/journal_two/import_notice.py` | + `missing_from_import` reason |
| `app/src/pages/journal-2-0/lib/importNoticeText.js` | + `missing_from_import` copy |
| `api/services/journal_two/db.py` | + three tables |
| `api/routers/journal_two.py` | media fetch route uses `hotlink_fetch`; + notice GET / dismiss |
| `tools/note_import_repair.py` | the CLI (dry run default, `--apply`) |
| `docs/runbooks/note-import-repair.md` | exact pod commands, review checklist, kill switch |
| `docs/feature_flags.json` | + `NOTE_IMPORT_REPAIR_ENABLED` |
| `app/src/pages/journal-2-0/components/notebook/ImportRepairNotice.jsx` (+ `.module.css`) | the one-time notice |
| `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` | mount the notice (lazy) |
| `app/src/pages/journal-2-0/components/notebook/import/ImportWizard.jsx` | `initialRecover` prop |

---

### Task 1: Shape detectors

**Files:**
- Create: `api/services/journal_two/import_repair/__init__.py`, `api/services/journal_two/import_repair/shapes.py`
- Test: `api/services/journal_two/test_import_repair_shapes.py`

**Interfaces:**
- Produces (in `__init__.py`): `FILE = "file"`, `CONNECTOR_LIVE = "connector_live"`, `CONNECTOR_RELIST = "connector_relist"`, `CONNECTOR_ORPHANED = "connector_orphaned"`, `NOTE_CLASSES = (FILE, CONNECTOR_LIVE, CONNECTOR_RELIST, CONNECTOR_ORPHANED)`.
- Produces (in `shapes.py`):
  - `WRITABLE_SHAPES = ("dead_import_link", "obsidian_pct_key", "relative_note_href", "bare_url", "hotlinked_image", "stranded_media_ref", "empty_image")`
  - `COUNT_ONLY_SHAPES = ("obsidian_literal_embed", "orphan_media")`
  - `LOSS_SHAPES = ("stranded_media_ref", "empty_image", "orphan_media")`
  - `is_relative_href(href: object) -> bool`
  - `is_hotlink_src(src: object) -> bool`
  - `detect_shapes(doc: dict) -> dict[str, int]` (every shape except `orphan_media`; zero counts omitted)
  - `orphan_media_count(user_id: str, note_id: str, body_json_text: str) -> int`

Shape definitions (exact):
- `dead_import_link`: a `link` mark whose href starts with `LINK_PREFIX`.
- `obsidian_pct_key`: such a mark whose key starts with `obsidian:` or `name:obsidian:` and contains `%[0-9A-Fa-f]{2}`.
- `relative_note_href`: a `link` mark whose href `is_relative_href`: a string with no scheme (`_SCHEME_RE` from `linkify.py`), not starting with `#`, `?`, `//`, `/journal`, `/terminal?cmd=`, `/api/j2/notes/attachments/`, `LINK_PREFIX`, `REF_PREFIX`.
- `bare_url`: `linkify_doc(doc) != doc` (the live allow-list decides; never restated).
- `hotlinked_image`: an `image` node whose `attrs.src` `is_hotlink_src`: starts `http://` or `https://` and its host is not `uctintelligence.com` / `www.uctintelligence.com`.
- `stranded_media_ref`: an `image` / `attachmentChip` with `src` / `href` starting `REF_PREFIX`.
- `empty_image`: an `image` node whose `src` is missing, not a string, or blank.
- `obsidian_literal_embed`: a text node whose stripped text fully matches `!?\[\[[^\]]+\.(png|jpe?g|gif|webp|svg|bmp|heic|avif|pdf)\]\]` (case-insensitive) or is exactly a bare such filename alone in its paragraph.
- `orphan_media`: files under `notes._ATTACHMENT_ROOT/<user>/notes/<note_id>/{inline,file}/` whose file name does not occur in `body_json_text` (read the dirs the way `notes._newest_media_mtime` does).

- [ ] **Step 1: Write the failing tests.** One pair per shape: a broken fixture that counts 1 and a clean fixture that counts 0. Clean fixtures, verbatim: `import-ref` inside an `importNotice` attr (not a stranded ref); `/journal?j2tab=notebook&note=abc` href; `#heading` href; `https://uctintelligence.com/api/j2/notes/attachments/u/x.png` image; `NVDA.US and BRK.B` text; `https://x.com` inside a `code` mark; an already-linked URL; an `obsidian:vault/Target Note.md` key with a literal space; a paragraph `see image.png for details`; a stored file whose name appears in the body.

```python
def test_each_shape_counts_its_broken_fixture_and_never_its_clean_twin(shape, broken, clean):
    assert shapes.detect_shapes(broken).get(shape) == 1
    assert shape not in shapes.detect_shapes(clean)

def test_orphan_media_counts_only_unreferenced_files(db):
    # two files on disk, body references one
    assert shapes.orphan_media_count(USER, NOTE, body_text) == 1
```

- [ ] **Step 2: Run to verify they fail.** `python -m pytest api/services/journal_two/test_import_repair_shapes.py -q` → FAIL (module not found).
- [ ] **Step 3: Implement** `shapes.py`. One recursive walk; `bare_url` calls `linkify_doc` (deep-copies, never mutates).
- [ ] **Step 4: Run to verify they pass.** Same command → PASS.
- [ ] **Step 5: Commit.** `git add api/services/journal_two/import_repair api/services/journal_two/test_import_repair_shapes.py && git commit -m "feat(import-repair): shape detectors for already-imported notes (Plan F Task 1)"`

---

### Task 2: The `missing_from_import` notice reason

**Files:**
- Modify: `api/services/journal_two/import_notice.py` (reason tuples, `NOTICE_COPY`)
- Modify: `app/src/pages/journal-2-0/lib/importNoticeText.js` (the client twin)
- Test: `tests/test_import_notice.py`, `app/src/pages/journal-2-0/lib/importNoticeNode.test.js`

**Interfaces:**
- Produces: `import_notice.REPAIR_REASONS = ("missing_from_import",)`, included in `NOTICE_REASONS`; copy key `"missing_from_import"`.

Ruling: a new reason, not `missing_resource`, because that sentence ("couldn't be found, so it wasn't copied") gives the member no way back, and the way back exists (recover). Exact copy, both tables:

`"missing_from_import": "{name} didn't come over in the original import. Import the same export again with Re-import to recover turned on to bring it back"`

It is final (`is_retryable` false), so `media_pending_state` answers 0 for a body holding only these.

- [ ] **Step 1: Failing tests.** In `tests/test_import_notice.py` add `("missing_from_import", "photo.png didn't come over in the original import. Import the same export again with Re-import to recover turned on to bring it back")` to the `test_each_reason_reads_its_sentence` parametrization, and `test_missing_from_import_is_final`: `media_pending_state({"type":"doc","content":[notice_node("missing_from_import", name="a.png", source_url=None, ref=None, attempts=0)]}) == 0`. In `importNoticeNode.test.js` add the rendered-text assertion for the same node.
- [ ] **Step 2: Run, expect FAIL.** `python -m pytest tests/test_import_notice.py -q`; `cd app && npx vitest run src/pages/journal-2-0/lib/importNoticeNode.test.js`.
- [ ] **Step 3: Implement** both tables and the reason tuples (client: the matching reason list the parity test reads).
- [ ] **Step 4: Run both, expect PASS** (the one-fact-in-two-files test included).
- [ ] **Step 5: Commit.** `git commit -m "feat(import-notice): missing_from_import, the repair's final marker (Plan F Task 2)"`

---

### Task 3: Link repair

**Files:**
- Create: `api/services/journal_two/import_repair/links.py`
- Test: `api/services/journal_two/test_import_repair_links.py`

**Interfaces:**
- Consumes: `shapes.is_relative_href`; `linkify.linkify_doc`, `linkify.import_link_keys`, `linkify.notion_note_key`; `link_keys.resolve_link_keys(conn, user_id, keys)`, `link_keys._media_passthrough(doc)`; `rewrite_body(doc, media_urls, id_by_key, strip_unresolved_links=False)`; `providers.obsidian._build_basename_map(paths)`, `providers.obsidian.resolve_pending_target(rest, index)`.
- Produces:
  - `STRIP_ID_PATTERN = r" [0-9a-f]{32}(?=(\.[a-z]+)?$)"` (IGNORECASE), `strip_notion_id_path(path: str) -> str`
  - `@dataclass FileKeyIndex: keys: frozenset[str]; obsidian: dict[str, Any]` (vault top folder → `_VaultIndex` over that vault's paths)
  - `build_file_key_index(conn, user_id: str) -> FileKeyIndex` (one query: the member's non-trashed `import_key`s; Obsidian paths from keys `obsidian:<path>` whose `import_source = 'Obsidian'`, grouped by first path segment)
  - `relative_target_key(href: str, *, import_key: str, import_source: str, index: FileKeyIndex) -> str | None`
  - `repair_links(doc: dict, *, note_class: str, import_key: str, import_source: str, index: FileKeyIndex, conn, user_id: str) -> tuple[dict, list[str]]` returns `(new_doc, actions)`; `actions` are short codes (`"pct_key_decoded"`, `"relative_to_note"`, `"relative_to_text"`, `"linkified"`, `"link_resolved:<n>"`).

Algorithm of `repair_links` (deep copy first; never mutates input):
1. Every `import-link://` key with `%xx` under `obsidian:` / `name:obsidian:` is decoded ONCE (`urllib.parse.unquote`).
2. `note_class == FILE` only: every relative href → `relative_target_key`; a key ⇒ href `LINK_PREFIX + key`; `None` ⇒ the link mark is removed and the text and other marks kept (spec L-4: an old note has no source URL to resolve against, and a relative href would land on our origin).
3. `linkify_doc` (all classes except `CONNECTOR_LIVE`, which the runner never repairs).
4. `id_by_key = resolve_link_keys(conn, user_id, import_link_keys(doc))`; `rewrite_body(doc, _media_passthrough(doc), id_by_key, strip_unresolved_links=False)`. Unresolved keys stay as placeholders (the live heal sweep finishes them once the target arrives, spec Q5).

`relative_target_key` rules (decode the href once, drop any `#fragment`):
- `import_source == "Obsidian"`: vault = first segment of the note's key path; `resolve_pending_target(f"{href}|{note dir within vault}|rel", index.obsidian[vault])` → `obsidian:<vault>/<path>`.
- `import_source == "Notion"`: `p = normpath(join(dir of the note's key path, href))`; try `notion:<strip_notion_id_path(p)>` then `notion:<p>` in `index.keys`; else if the last segment ends in a 32-hex id, `notion_note_key(id)` (it opens notion.so now and heals later, same as the live client); else `None`.
- a `file:` key: `file:<normpath(join(dir, href))>` if in `index.keys`, else `None`.
- anything else: `None`.

- [ ] **Step 1: Failing tests.**

```python
def test_relative_obsidian_link_becomes_a_note_link(db): ...      # [x](Other%20note.md) -> /journal?...note=<id>
def test_pct_keyed_obsidian_link_resolves_after_one_decode(db): ...
def test_notion_zip_relative_link_resolves_by_stripped_path(db): ...
def test_notion_page_outside_the_export_keeps_a_working_key(db): ...  # -> import-link://notion:<dashed uuid>
def test_unresolvable_relative_href_becomes_plain_text(db): ...
def test_ambiguous_relative_targets(db): ...      # same-folder wins, else shortest; duplicate Notion name -> text
def test_linkify_obeys_the_live_allow_list(db):   # every row of __fixtures__/linkify_vectors.json, through repair_links
def test_repair_links_is_a_fixed_point(db):       # repair_links(repair_links(x)) == repair_links(x), actions == []
def test_strip_id_pattern_matches_the_client():
    src = Path("app/src/pages/journal-2-0/lib/importer/adapters/notion.js").read_text(encoding="utf-8")
    assert f"const STRIP_ID_RE = /{links.STRIP_ID_PATTERN}/i" in src
```

- [ ] **Step 2: Run, expect FAIL.** `python -m pytest api/services/journal_two/test_import_repair_links.py -q`
- [ ] **Step 3: Implement** `links.py` as specified.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(import-repair): link repair over stored bodies, reusing the live resolvers (Plan F Task 3)"`

---

### Task 4: Media repair and the shared hotlink fetch

**Files:**
- Create: `api/services/journal_two/hotlink_fetch.py`, `api/services/journal_two/import_repair/media.py`
- Modify: `api/routers/journal_two.py:2715-2793` (`notes_media_fetch_endpoint` calls `hotlink_fetch.fetch_and_store`)
- Test: `api/services/journal_two/test_import_repair_media.py`; `tests/test_note_media_fetch_route.py` must stay green unchanged

**Interfaces:**
- Produces:
  - `hotlink_fetch.FETCH_TIMEOUT_S = 30.0`, `hotlink_fetch.FETCH_DEADLINE_S = 60.0` (moved from the router; the router imports them, one value each)
  - `async def hotlink_fetch.fetch_and_store(user_id: str, note_id: str, url: str) -> media_policy.StoredMedia`: `fetch_content_url` through `media_http_client(timeout=FETCH_TIMEOUT_S)` under `asyncio.wait_for(..., FETCH_DEADLINE_S)`, then `normalize_media` + `store_media(..., budget=MediaBudget.for_member(user_id))` in a thread; raises whatever they raise. The route keeps its rate limit, in-flight cap, semaphore, 422 mapping and documents hand-off around it.
  - `media.missing_notices(doc: dict) -> tuple[dict, list[str]]`: every `stranded_media_ref` and `empty_image` node becomes `notice_node("missing_from_import", name=<attrs.alt or attrs.title or basename of the ref or None>, source_url=None, ref=None, attempts=0)`; stranded refs go through `rewrite_body(doc, {}, {}, strip_unresolved_links=False, notices={ref: node})`, empty images are replaced in place.
  - `media.hotlinks(doc: dict) -> list[str]` (distinct, document order)
  - `media.replace_src(doc: dict, old: str, new: str) -> dict` (deep copy; every `image` with `src == old`; other attrs kept)

Ruling: a hotlink that fails to copy (refused, unreachable, over the storage cap) is LEFT AS IT IS. It still renders today and is the member's best copy; a marker beside a working picture would tell the member something false. The failure is logged per note and the next run retries it.

- [ ] **Step 1: Failing tests.** `test_missing_notices_replace_stranded_refs_and_empty_images`, `test_missing_notices_leave_a_resolved_image_alone`, `test_replace_src_keeps_alt_and_title`, `test_fetch_and_store_stores_our_copy` (mock transport, as `test_note_media_fetch_route.py` does), `test_fetch_and_store_raises_on_refusal`.
- [ ] **Step 2: Run, expect FAIL.** `python -m pytest api/services/journal_two/test_import_repair_media.py -q`
- [ ] **Step 3: Implement** `hotlink_fetch.py` by moving the download/normalize/store core out of the route; then `media.py`.
- [ ] **Step 4: Run, expect PASS**, plus `python -m pytest tests/test_note_media_fetch_route.py -q` → PASS unchanged.
- [ ] **Step 5: Commit.** `git commit -m "refactor(notes): one hotlink fetch for the door and the repair; feat(import-repair): missing-media notices (Plan F Task 4)"`

---

### Task 5: Repair tables and their store

**Files:**
- Modify: `api/services/journal_two/db.py` (`_J2_SCHEMA` + the matching `ensure_schema` path, following how `j2_note_sources` is declared twice)
- Create: `api/services/journal_two/import_repair/store.py`
- Test: `api/services/journal_two/test_import_repair_store.py`

**Interfaces:**
- Tables (exact):
  - `j2_import_repair_progress(run_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, notes_checked INTEGER NOT NULL DEFAULT 0, notes_repaired INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, finished_at TEXT, PRIMARY KEY (run_id, user_id))`
  - `j2_import_repair_log(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, user_id TEXT NOT NULL, note_id TEXT NOT NULL, outcome TEXT NOT NULL, shapes_json TEXT NOT NULL, actions_json TEXT NOT NULL, before_body_json TEXT, created_at TEXT NOT NULL)` + index `(run_id, user_id)`
  - `j2_import_repair_notices(user_id TEXT PRIMARY KEY, loss_notes INTEGER NOT NULL, created_at TEXT NOT NULL, dismissed_at TEXT)`
- Produces (all take an open `conn`; none commits except where stated):
  - `OUTCOMES = ("repaired", "kept_edited", "race_lost", "failed", "fetch_failed", "relist_requested")`
  - `member_done(conn, run_id: str, user_id: str) -> bool`
  - `start_member(conn, run_id, user_id) -> None` (INSERT OR IGNORE, `status='in_progress'`)
  - `finish_member(conn, run_id, user_id, *, checked: int, repaired: int) -> None` (UPDATE, `status='done'`, commits)
  - `log_note(conn, run_id, user_id, note_id, outcome, shapes: dict, actions: list, before_body_json: str | None) -> None`
  - `record_notice(conn, user_id, loss_notes: int) -> None` (INSERT OR IGNORE: never re-arms a dismissed notice)
  - `pending_notice(conn, user_id) -> int | None` (`loss_notes` while `dismissed_at IS NULL`)
  - `dismiss_notice(conn, user_id) -> bool` (UPDATE sets `dismissed_at`; commits)

Ruling: `before_body_json` keeps the pre-repair body of every REPAIRED note in the log (an undo source the owner can use with an UPDATE). Not a `j2_note_versions` row: a captured version would surface in the member's History and changes what `legacy_finalize_shape` reads.

- [ ] **Step 1: Failing tests.** `test_progress_marks_and_resumes`, `test_record_notice_never_rearms_a_dismissed_notice`, `test_dismiss_is_an_update`, `test_log_note_round_trips`.
- [ ] **Step 2: Run, expect FAIL.** `python -m pytest api/services/journal_two/test_import_repair_store.py -q`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(import-repair): progress, per-note log and notice tables (Plan F Task 5)"`

---

### Task 6: Runner, selection and the dry-run scan

**Files:**
- Create: `api/services/journal_two/import_repair/runner.py`
- Test: `api/services/journal_two/test_import_repair_runner.py`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5; `import_provenance.edited_since_import`, `predates_finalize_stamp`, `legacy_finalize_shape`; `notes._newest_media_mtime`; `note_connectors.registry._REGISTRY`; `sample_marker.reserved_for_the_sample`.
- Produces:
  - `FLAG = "NOTE_IMPORT_REPAIR_ENABLED"`, `RUN_ID_DEFAULT = "2026-11-connector-fidelity-f"`, `MAX_SCAN_BODY_BYTES = 4_000_000`, `SAMPLE_PER_SHAPE = 5`
  - `@dataclass(frozen=True) NoteRow: id, import_source, import_key, updated_at, imported_at, body_bytes`
  - `iter_members(conn) -> Iterator[str]`: `SELECT DISTINCT user_id FROM j2_notes WHERE imported_at IS NOT NULL AND import_key IS NOT NULL AND deleted_at IS NULL ORDER BY user_id`
  - `iter_note_rows(conn, user_id) -> Iterator[NoteRow]`: same filter plus `length(body_json)`; NO body column (bodies are read one at a time by `load_body`)
  - `load_body(conn, note_id) -> str`
  - `active_providers(conn, user_id) -> set[str]`: `provider` of the member's `j2_note_sources` rows with `status = 'active' AND sync_enabled = 1`
  - `classify(row: NoteRow, active: set[str]) -> str | None`: `None` for the sample notebook; `import_source` exactly a registry provider id ⇒ `CONNECTOR_RELIST` if `"obsidian"` and active, `CONNECTOR_LIVE` if active, else `CONNECTOR_ORPHANED`; anything else ⇒ `FILE`. (Ruling: the file importer stores its adapter LABEL, `'Evernote'`, `'Notion'`, `'Obsidian'`, `'Files (Markdown, Text, HTML, Word)'`, ..., and the engine stores the lowercase provider id, so an exact match separates them.)
  - `hands_off(row: NoteRow) -> bool`: `return edited_since_import(row.updated_at, row.imported_at)`. **THE guard. Called only inside `plan_note`.**
  - `@dataclass NotePlan: note_class, shapes: dict[str,int], kept_edited: bool, legacy_finalize: bool, new_doc: dict | None, actions: list[str], hotlinks: list[str], loss: bool`
  - `plan_note(conn, user_id, row, note_class, index) -> NotePlan`: detects shapes (+ `orphan_media` for `FILE`); `kept_edited = hands_off(row)`; if kept_edited, `legacy_finalize` = the Plan B composition (counted only), and `new_doc = None`. Otherwise for `FILE` and `CONNECTOR_ORPHANED`: `repair_links` then (FILE only) `missing_notices`; `new_doc` is `None` when nothing changed. `hotlinks` listed for `FILE` only. `CONNECTOR_LIVE` and `CONNECTOR_RELIST` notes are never planned for a write (counted only). `loss` = any `LOSS_SHAPES` count > 0 on a FILE note, edited or not.
  - `scan(conn, *, run_id: str, members: list[str] | None = None, sleep_ms: int = 0) -> dict`: the dry-run report below. Never writes.

Dry-run report (JSON, exact keys):

```json
{"runId": "...", "mode": "dry-run", "startedAt": "...", "finishedAt": "...", "peakRssMb": 0,
 "sourcesNotFullSyncedSinceConverter": 0,
 "totals": {"members": 0, "notesScanned": 0, "tooLargeToScan": 0,
   "byClass": {"file": 0, "connector_live": 0, "connector_relist": 0, "connector_orphaned": 0},
   "byShape": {"<shape>": {"unedited": 0, "edited": 0}},
   "bySource": {"<import_source>": {"<shape>": 0}},
   "wouldRepairNotes": 0, "hotlinksToFetch": 0, "keptEdited": 0, "legacyFinalize": 0,
   "obsidianSourcesToRelist": 0, "noticeMembers": 0},
 "perMember": [{"userId": "...", "notes": 0, "wouldRepair": 0, "byShape": {}, "lossNotes": 0}],
 "samples": {"<shape>": ["<note id>", "..."]}}
```

`sourcesNotFullSyncedSinceConverter` counts active sources whose `last_full_sync_at` is earlier than `2026-11-03T05:47:00+00:00`: it must read 0 before the numbers mean "what the nightly re-convert left". `perMember` lists only members with at least one shape. No titles, no text.

- [ ] **Step 1: Failing tests.**

```python
def test_classify_separates_file_labels_from_provider_ids(): ...
def test_scan_counts_per_member_shape_and_source(db): ...
def test_scan_counts_an_edited_note_and_plans_no_write(db): ...
def test_scan_counts_live_connector_notes_but_never_plans_them(db): ...
def test_scan_opens_nothing_for_write(db):          # run scan on a mode=ro connection; total_changes == 0
def test_huge_body_is_counted_not_parsed(db, monkeypatch):  # json.loads spy never sees it
def test_bodies_are_read_one_at_a_time(db, monkeypatch):    # iter_note_rows SQL selects no body_json
```

- [ ] **Step 2: Run, expect FAIL.** `python -m pytest api/services/journal_two/test_import_repair_runner.py -q`
- [ ] **Step 3: Implement** selection, `classify`, `hands_off`, `plan_note`, `scan`. `peakRssMb` from `resource.getrusage` where available (Linux pod), else 0.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(import-repair): selection, the one hands-off guard, and the dry-run scan (Plan F Task 6)"`

---

### Task 7: Apply, with the rails

**Files:**
- Modify: `api/services/journal_two/import_repair/runner.py`
- Test: `api/services/journal_two/test_import_repair_apply.py`, `api/services/journal_two/test_import_repair_no_delete.py`

**Interfaces:**
- Consumes: Task 6; `engine._apply_resolved_body`; `hotlink_fetch.fetch_and_store`; `media.replace_src`; Task 5 store.
- Produces:
  - `class RepairRefused(Exception)`
  - `apply(conn, *, run_id: str, members: list[str] | None = None, max_fetches: int = 2000, sleep_ms: int = 20) -> dict`: raises `RepairRefused` unless `os.environ.get(FLAG) == "1"`. Per member, skipping `member_done`: `start_member`; for a member with `CONNECTOR_RELIST` notes, `UPDATE j2_note_sources SET cursor = NULL WHERE user_id = ? AND provider = 'obsidian' AND status = 'active' AND sync_enabled = 1`, one `relist_requested` log row per source (actions carry the prior cursor); then per note `plan_note`; for a plan with a `new_doc` or hotlinks: fetch each hotlink (`asyncio.run(fetch_and_store(...))`, counting toward `max_fetches`; a failure logs `fetch_failed` and keeps the image), `notes._validate_body_json(new_doc)`, `applied = engine._apply_resolved_body(conn, user_id, row.id, new_doc, expected_updated_at=row.updated_at)`; `applied` ⇒ `repaired` (with `before_body_json`), else `race_lost`; an exception ⇒ `failed`, the run goes on. `kept_edited` notes with shapes are logged `kept_edited` (no body). After the member: `record_notice` when `lossNotes > 0`; `finish_member`. Returns the scan-shaped report with `"mode": "apply"` plus `repaired`, `raceLost`, `failed`, `fetchFailed`, `fetched`.

Ruling: the Obsidian re-list is a cursor reset, executed by the web process's own scheduled sync, not a sync started from the CLI: the engine's per-source in-flight guard is per process, so a CLI-started sync could race the web pod's on the same source. If a sync in flight writes its cursor back over the NULL, the next run's dry run still shows those notes and a re-run resets again (idempotent).

- [ ] **Step 1: Failing tests.**

```python
def test_apply_refuses_without_the_flag(db, monkeypatch): ...
def test_an_edited_note_is_never_written(db, monkeypatch):
    # edited FILE note carrying bare_url + relative_note_href: body, updated_at, imported_at unchanged; log outcome kept_edited
def test_the_guard_is_what_protects_it(db, monkeypatch):
    # CONTROL: monkeypatch runner.hands_off -> lambda row: False; the same note IS rewritten.
    # Proves the test above fails without the guard (the in-suite mutation).
def test_a_note_edited_after_planning_is_not_overwritten(db, monkeypatch):
    # bump updated_at between plan_note and _apply_resolved_body; outcome race_lost; member body intact
def test_writes_are_timestamp_neutral(db, monkeypatch):
    # updated_at, imported_at, import_hash, import_remote_rev, count(j2_note_versions) all unchanged; import_links_pending recomputed
def test_apply_is_idempotent(db, monkeypatch):
    # second apply with a NEW run id: repaired == 0, no new 'repaired' log rows, bodies byte-identical
def test_resume_after_interruption(db, monkeypatch):
    # raise after member 1; re-run same run id: member 1 skipped, member 2 done once
def test_failed_hotlink_keeps_the_image(db, monkeypatch): ...
def test_obsidian_relist_resets_only_active_obsidian_cursors(db, monkeypatch): ...
def test_notice_recorded_only_for_members_with_losses(db, monkeypatch): ...
```

`test_import_repair_no_delete.py`: every `.py` under `api/services/journal_two/import_repair/` plus `tools/note_import_repair.py`, read as text, contains no `DELETE` (case-insensitive word match), with a control string that does.

- [ ] **Step 2: Run, expect FAIL.** `python -m pytest api/services/journal_two/test_import_repair_apply.py api/services/journal_two/test_import_repair_no_delete.py -q`
- [ ] **Step 3: Implement `apply`.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Mutation proof by hand.** Edit `hands_off` to `return False`; run `python -m pytest api/services/journal_two/test_import_repair_apply.py -q -k edited_note_is_never_written` → FAIL; restore it with Edit (never `git checkout`); delete `__pycache__` under `import_repair/`; re-run → PASS. Record both outputs in the commit message.
- [ ] **Step 6: Commit.** `git commit -m "feat(import-repair): apply, guarded, timestamp-neutral, resumable (Plan F Task 7)"`

---

### Task 8: The CLI, the runbook and the flag ledger

**Files:**
- Create: `tools/note_import_repair.py`, `docs/runbooks/note-import-repair.md`
- Modify: `docs/feature_flags.json`
- Test: `tests/test_note_import_repair_cli.py`; `tests/test_feature_flag_ledger.py` must stay green

**Interfaces:**
- Consumes: `runner.scan`, `runner.apply`, `runner.RepairRefused`, `auth_db._DB_PATH`.
- CLI (argparse): `--apply`, `--run-id` (default `RUN_ID_DEFAULT`), `--member <user_id>` (repeatable), `--max-fetches` (2000), `--sleep-ms` (20), `--out <path>` (also write the JSON there). Dry run opens `sqlite3.connect(f"file:{path}?mode=ro", uri=True)`; apply opens `auth_db.get_connection()`. Prints the report JSON to stdout. Takes an exclusive `fcntl.flock` on `<DATA_DIR>/.note_import_repair.lock` (skip on Windows); a second run exits 3. Never imports `api.main`.
- Exit codes: 0 ok · 2 refused (flag off for `--apply`) · 3 another run holds the lock · 5 DB missing.

Ruling, where it runs: **on the web pod, from a separate process, outside 9:30-16:00 ET.** A local copy of `auth.db` would put member notes on a PC (spec §11 forbids it). The run is light by construction: one body in memory, `nice -n 19`, `--sleep-ms` between notes, no `api.main` import, `peakRssMb` in the report so the owner sees the cost. The precedent is `tools/reencrypt_at_rest.py`.

Runbook copy (`docs/runbooks/note-import-repair.md`), the commands verbatim:
1. Precondition: the 2026-11-03 01:47 ET nightly ran (`sourcesNotFullSyncedSinceConverter == 0` in the dry run).
2. Dry run: `railway ssh --service web`, then `nice -n 19 /opt/venv/bin/python tools/note_import_repair.py --out /data/import_repair/dryrun-1.json`.
3. Owner review checklist: `byShape` unedited vs edited; `wouldRepairNotes`; `hotlinksToFetch`; `keptEdited` and `legacyFinalize`; `noticeMembers`; `peakRssMb` under 300.
4. Arm: `railway variables --set NOTE_IMPORT_REPAIR_ENABLED=1 --service web` (this redeploys `web`).
5. Apply: `railway ssh --service web`, then `nohup nice -n 19 /opt/venv/bin/python tools/note_import_repair.py --apply --out /data/import_repair/apply-1.json > /data/import_repair/apply-1.log 2>&1 &`.
6. Kill switch: `railway variable delete NOTE_IMPORT_REPAIR_ENABLED --service web` then `railway redeploy --service web --yes` (a delete alone does not restart the pod; the redeploy ends the run, and `--apply` refuses to start again). Resume later with the same `--run-id`.
7. After: disarm as in 6; re-run the dry run; writable shapes on unedited file notes should be 0 apart from `fetch_failed` hotlinks and unresolvable pending keys.

Ledger entry: `"NOTE_IMPORT_REPAIR_ENABLED": {"status": "pending", "since": "2026-11-02", "where": [], "note": "Plan F: gates tools/note_import_repair.py --apply only. Set on web for the one production run after the owner approves the dry-run numbers, then deleted + redeployed (runbook docs/runbooks/note-import-repair.md)."}`

- [ ] **Step 1: Failing tests.** `test_dry_run_is_default_and_read_only` (temp DB; file mtime and `total_changes` unchanged), `test_apply_without_flag_exits_2`, `test_report_is_json_with_the_documented_keys`, `test_cli_never_imports_api_main` (subprocess `-c` import, `"api.main" not in sys.modules`), `test_second_run_exits_3_while_locked` (skipped on Windows).
- [ ] **Step 2: Run, expect FAIL.** `python -m pytest tests/test_note_import_repair_cli.py -q`
- [ ] **Step 3: Implement** the CLI, the runbook and the ledger entry.
- [ ] **Step 4: Run, expect PASS**, and `python -m pytest tests/test_feature_flag_ledger.py -q` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(import-repair): the pod CLI, dry run by default; runbook; flag ledger (Plan F Task 8)"`

---

### Task 9: The member notice API

**Files:**
- Modify: `api/routers/journal_two.py` (declare beside `/notes/import/heal-links`, above every `/notes/{note_id}` route)
- Test: `tests/test_notes_import_repair_notice_router.py`

**Interfaces:**
- Consumes: `store.pending_notice`, `store.dismiss_notice`.
- Produces:
  - `GET /api/j2/notes/import/repair-notice` → `{"show": bool, "lossNotes": int}` (`show` false and `lossNotes` 0 when no undismissed row)
  - `POST /api/j2/notes/import/repair-notice/dismiss` → `{"ok": true}` (idempotent)

- [ ] **Step 1: Failing tests.** `test_no_row_means_no_notice`, `test_a_recorded_notice_shows_once_then_dismiss_hides_it_forever`, `test_one_member_cannot_see_or_dismiss_another_members_notice`, `test_routes_are_not_shadowed_by_note_id_routes`.
- [ ] **Step 2: Run, expect FAIL.** `python -m pytest tests/test_notes_import_repair_notice_router.py -q`
- [ ] **Step 3: Implement** both routes.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(import-repair): the member notice doors (Plan F Task 9)"`

---

### Task 10: The one-time notice in the Notebook

**Files:**
- Create: `app/src/pages/journal-2-0/components/notebook/ImportRepairNotice.jsx`, `ImportRepairNotice.module.css`
- Modify: `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` (near `importOpen`, `:443`, and the `ImportWizard` mount, `:2648`), `app/src/pages/journal-2-0/components/notebook/import/ImportWizard.jsx` (`:272`, `:302`)
- Test: `app/src/pages/journal-2-0/components/notebook/ImportRepairNotice.test.jsx`, `ImportWizard.test.jsx`

**Interfaces:**
- Consumes: Task 9's two routes.
- Produces: `<ImportRepairNotice lossNotes={number} onRecover={fn} onDismiss={fn} />`; `ImportWizard` prop `initialRecover?: boolean` (seeds `recoverMode`; default false, so every existing caller is unchanged).

Mount: NotebookTab fetches `GET .../repair-notice` once per mount with no new static import; only when `show` is true does it `lazy()`-load `ImportRepairNotice` (first-open byte budget unchanged). It renders above the note list. "Re-import to recover" POSTs dismiss, then opens the wizard with `initialRecover`. "Dismiss" POSTs dismiss and hides it. Either way it never shows again.

Exact copy (ASCII apostrophes, no em dashes):
- Heading: `Some imported notes are missing pictures`
- Body, `lossNotes === 1`: `When you imported from Evernote, Notion or Obsidian, 1 note lost a picture or file on the way in. Where we could, we've marked the spot in the note. Import the same export again with Re-import to recover turned on to bring it back. Notes you've changed since importing are never touched.`
- Body, otherwise: `When you imported from Evernote, Notion or Obsidian, {n} notes lost a picture or file on the way in. Where we could, we've marked the spot in each note. Import the same export again with Re-import to recover turned on to bring them back. Notes you've changed since importing are never touched.`
- Buttons: `Re-import to recover` · `Dismiss`

- [ ] **Step 1: Failing tests.** `renders the singular and plural copy exactly`, `Re-import to recover dismisses then opens the wizard with recover ticked`, `Dismiss posts once and hides`, `nothing renders and no chunk loads when show is false`; in `ImportWizard.test.jsx`: `initialRecover ticks the recover box once a re-import is possible`.
- [ ] **Step 2: Run, expect FAIL.** `cd app && npx vitest run src/pages/journal-2-0/components/notebook/ImportRepairNotice.test.jsx src/pages/journal-2-0/components/notebook/import/ImportWizard.test.jsx`
- [ ] **Step 3: Implement.** Use `UIcon`, no emoji; touch targets `var(--tap-min)` at ≤1024px.
- [ ] **Step 4: Run, expect PASS.** Also run the Notebook first-open byte-budget rail named in CLAUDE.md for NotebookTab.
- [ ] **Step 5: Commit.** `git commit -m "feat(notebook): one-time notice for imports that lost pictures, opening recover (Plan F Task 10)"`

---

## Deploy shape

- **PR F1, server (Tasks 1-9).** Web-only. Inert on merge: nothing runs until someone runs the CLI, and the notice route answers `show: false` with an empty table. Task 2 also touches `importNoticeText.js`; it ships here so that the client knows the new reason before any repair writes one. No `requirements.txt` change, so no `UCT_FLOW_OVERRIDE` step and no 9:30-16:00 ET merge restriction. Before merging, run `python tools/flow_worker_watch_coverage.py` and classify any red per `docs/runbooks/deploy-windows.md` (expected: `db.py`, an inert strand for flow-worker).
- **PR F2, client (Task 10).** Web-only. Can merge with or after F1.
- Verify a deploy by the commit in `origin/production` plus the deploy commitHash, not by an uptime reset.

## Rollout and the owner's click points

1. Merge F1 and F2. **Owner click point (2): merge the PRs** wherever the classifier blocks `gh pr merge`.
2. Wait for the 2026-11-03 01:47 ET nightly. It is the first full pass after the converter merge; it re-converts unedited Notion/Roam/Craft notes.
3. Dry run on the pod, outside 9:30-16:00 ET (runbook step 2). `railway ssh` reads production: if the classifier blocks it, the owner runs the one command and pastes the JSON.
4. **Owner click point (1): approve the dry-run numbers.** Nothing writes before this.
5. Arm, apply, disarm (runbook steps 4-6), outside market hours. The `railway variables` and `ssh` commands go to the owner if the classifier blocks them.
6. Re-run the dry run and record the before/after numbers in `docs/notebook-connectors/RESUME-connector-fidelity.md`.

## Self-review notes

- Spec §9: file imports are repaired from the stored body (Tasks 3, 4, 7). Connector notes are repaired from the source: Notion/Roam/Craft by the nightly pass (already live), Obsidian by the cursor reset (Task 7). Edited notes get nothing (ruling: a suggestion line would itself be a write). The run is timestamp-neutral, logged and dry run first (Tasks 5-8). Obsidian images wait on Plan C's plugin re-send.
- Spec Q1(a): link fixes on stored bodies (Task 3), the visible marker where a dropped image is detectable (Tasks 2, 4). Detectable means a stranded `import-ref://` or an empty image node. Orphaned uploads are counted only, because where the image sat is unknowable. Failed-upload records were never persisted for file imports, so none can be read. Q1(b): already live (Plan B); Task 10 points at it. Q1(c): the one-time notice (Tasks 9, 10).
