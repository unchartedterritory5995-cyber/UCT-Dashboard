# Notebook P3b: Example Notes and the Sanitizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an author can attach an **example note** to a style they share in the community library, so browsers see the style "in use". Before anything is published, the author sees exactly what will be public:
- account sizes, P&L, broker names, linked trades, personal rule evidence and captured financial facts are replaced with "your value here";
- every image is off until the author switches it on, and each image shows OCR warnings for dollar amounts, long digit runs and broker names.

Every example note goes through the existing review queue. The feature is dark behind `NOTEBOOK_EXAMPLE_NOTES_ENABLED`.

**Architecture:**
- **One reducer, one more mode.** `public_note_payload.reduce` gains `mode="example"`. It is the single authority over what leaves the account (`public_note_payload.py:1-48`), and a second sanitizer would be a second authority.
  - The `example` mode keeps less than `publish` and more than `gallery`: images survive only if the author switched them on.
  - It adds a text pass for money amounts and broker names.
  - It resets every trader block to its empty builder params, so a viewer's copy renders with their own data.
  - It returns, beside the body, a **change list** naming every replacement. That list is what the preview shows.
- **A snapshot, never a live page.** Publishing stores the reduced body in the gallery row's `payload_json` (P3a's column), with `item_type = 'example_note'` and a link to one of the author's own style items. Later edits to the note never reach the library. The author publishes again, and that revision is held as a pending revision (P3a's R-P3-3).
- **Images are copied, not linked.** Each switched-on image is copied at publish time into a gallery-owned directory under the attachment root and served by a paid-gated route with the public headers. Withdrawing the item or purging the account deletes the copies.
- **No first-open bytes.**
  - The door lives in P3a's lazy Share flow, and the preview is a lazy sheet.
  - The switch is server-only: the lazy library list reports `capabilities.exampleNotes`, so no `FLAG_FALLBACKS` row is added.

**Tech Stack:** FastAPI, SQLite, pytest, React + Vite, vitest + Testing Library, Python Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md`, sections:
- §P3.1 (lines 289-292)
- §P3.2 (294-303)
- §P3.3 item page (308-309)
- §P3.4 (326-329)
- §6 (361-378)

**Depends on:** P3a (`docs/superpowers/plans/2026-10-17-notebook-p3a-style-library.md`) **merged to master**. P3b uses P3a's:
- `item_type` and `ITEM_TYPES`;
- `payload_json`, `pending_json` and versions;
- authors;
- the lazy `TemplateGallery` library UI, `ShareStyleForm` and `StylesManager` Share;
- the admin preview.

**Base:** `origin/master` after P3a's merge. Integration worktree `C:\Users\Patrick\uct-worktrees\notebook-p3b`, branch `notebook-p3b-examples`, with a `.uct-session-owner` file.

## Rulings (each also in the ledger and the PR body)

**R-P3b-1. A snapshot, not a live published page.**
- The spec says an example note is "a published note (existing publish infrastructure)". P3b reuses the publish infrastructure's **reducer**, its image proxy headers and its review queue. It does not reuse its live slug.
- The example is a reduced snapshot stored in `payload_json`.
- Why: a live published page would show later edits, which nobody sanitized or reviewed.
- Cost if wrong: an author re-shares to refresh the example.

**R-P3b-2. An example belongs to a style.**
- An `example_note` item must name `linked_item_id`: a `style` item by the same author, listed or pending, not withdrawn.
- A style shows at most 3 approved examples, newest first.
- An example is never listed on its own. The library's type chips do not gain "Example notes".
- Why: the spec says "linked to a style, so browsers see it in use".
- Cost if wrong: a later plan can list examples alone.

**R-P3b-3. What `example` mode replaces.** Each row is also a test in Task 2.

| In the note | Becomes |
|---|---|
| A trader block (every id in `trader_blocks.BLOCK_IDS`) | The same block with its builder's empty params (`BUILDERS[id]` output params). A viewer's copy reads the viewer's own data. |
| `financialFact` | The text `your value here` |
| Any market-data `widgetEmbed` | The neutral line, whatever its vendor (gallery mode's rule) |
| `notebook` / `alerts` embeds (private) | Dropped (publish's rule) |
| `tradeRef` / `tradeRefType` attrs, trade cards, trade links | Dropped; the text stays |
| A money amount in text: `$` or `-$` or `+$` followed by digits, with optional `,` groups, decimals and `k`/`K`/`m`/`M` | `your value here` |
| An R or percent figure glued to P&L words (`pnl`, `p&l`, `profit`, `loss`, `up`, `down`, `made`, `lost` within 3 words before) | `your value here` |
| A broker name (Task 2's list ∪ the author's own `j2_broker_accounts` institution names) | `your broker` |
| An email address | `email address` (the existing rule) |
| `noteLink` | `linked note` (the existing rule) |
| `askInsert` / `askCitation` | Dropped (gallery's rule) |
| Task items | Unchecked (gallery's rule) |
| An image the author left off | Dropped |
| An image the author switched on | Kept, with `src` rewritten to the gallery image route |

- Prices of tickers without a `$` ("NVDA 132.40") are kept: a level in a plan is the example's point, and the author sees it in the preview.
- Why: the spec's list, made concrete, and each case is visible in the change list.
- Cost if wrong: a pattern misses a case, and the preview plus the review queue are the backstop. Both show exactly the public body.

**R-P3b-4. The change list.**
- `reduce(..., mode="example", report=changes)` appends one entry per replacement: `{kind, before, after, path}`.
  - `kind` is one of `money`, `pnl_figure`, `broker`, `email`, `block_reset`, `fact`, `market_data`, `trade_link`, `image_off`, `dropped`.
  - `before` is at most 60 characters of the original text. It appears only in the AUTHOR's preview response and is never stored.
- The preview shows the counts by kind, and each replaced span highlighted in place.
- Why: "the author sees exactly what will be public".
- Cost if wrong: none found.

**R-P3b-5. OCR warnings, never OCR blocking.**
- Each image in the note is listed with its OCR state, read from the document pipeline that already runs on pasted images (`lib/screenshotRead.js:1-6`, `document_ocr.document_text_state` / `page_transcript`):
  - `ready` gives warnings for dollar amounts, digit runs of 6 or more, and broker names, each with the matched text;
  - `no_text` gives no warnings;
  - `processing` or `unavailable` gives `We couldn't read this image yet. Check it yourself before switching it on.`
- Warnings never block a switch, because the author decides. An image with a warning carries a second confirm: `This image may show an account detail. Share it anyway?`.
- Why: the spec says OCR "warns".
- Cost if wrong: none found.

**R-P3b-6. Server-only switch.**
- `NOTEBOOK_EXAMPLE_NOTES_ENABLED` is read per request in the gallery service, and every example route answers the gallery's one 404 when it is off.
- The library list (lazy) reports `capabilities: {exampleNotes: bool}`, and the lazy UI reads that.
- The switch is not in `NOTEBOOK_FLAGS`, and there is no `FLAG_FALLBACKS` row.
- It needs `NOTEBOOK_STYLE_LIBRARY_ENABLED` too.
- Why: 0 first-open bytes, and nothing eager needs to know.
- Cost if wrong: a stale lazy list keeps the door for one fetch, and the route still 404s.

**R-P3b-7. Image limits.**
- At most 6 images per example, each at most 2 MB, and only PNG, JPEG or WebP (the stored extension the attachment root already records).
- Copies go to `<attachment_root>/gallery/<item_id>/<n>.<ext>`, served by `GET /api/j2/template-gallery/{item_id}/images/{n}` behind `require_paid`, with `PUBLIC_HEADERS` plus the image CSP (`public_note_payload.py:63-84`).
- Why: bounded storage, and the same response contract strangers already get.
- Cost if wrong: a seventh image is refused with `An example can show up to 6 images.`

**R-P3b-8. Rate limits.** Example publish shares P3a's style-publish scopes: 10 per hour, plus the durable 10 per day.

**R-P3b-9. The door.**
- In P3a's lazy `ShareStyleForm`, and on a style item's own page for its author, there is an `Add an example note` button. It opens a lazy note picker listing the author's live notes whose kind matches the style's kind, newest first, with a search box. Picking a note opens the preview sheet.
- There is no door in the note editor, which is eager.
- Why: bytes, and the example's whole point is the style.
- Cost if wrong: one more click. A later plan can add an editor door when headroom allows.

## Global Constraints

P3a's Global Constraints apply, with these values:
- `$WT = C:\Users\Patrick\uct-worktrees\notebook-p3b`.
- **Bytes:** the first-open closure is **unchanged** (+0 B) against Task 1's base.
- **Privacy:**
  - the server reduces again on publish and never trusts a client-sent body;
  - `before` text from the change list is never stored or logged;
  - telemetry gets no example events (P5 owns telemetry).
- **The reducer stays in the schema layer's import closure:** no web framework at module level (`public_note_payload.py:50-56`, rail `tests/test_j2_db_import_closure.py`).

## Review Focus

1. **A note whose text says "made $1,240 on NVDA, up 3.2R, at Schwab".**
   - Expected: the public body reads "made your value here on NVDA, up your value here, at your broker", and the change list has 3 entries.
   - Pinned in Task 2, `test_money_pnl_and_broker_in_one_sentence`.
2. **The author edits the note after publishing.**
   - Expected: the listed example is unchanged.
   - Pinned in Task 3, `test_a_later_note_edit_never_reaches_the_example`.
3. **A client posts a hand-made `body` with an unsanitized amount.**
   - Expected: the server ignores it and reduces the note itself.
   - Pinned in Task 3, `test_publish_never_trusts_a_client_body`.
4. **The author withdraws the style.**
   - Expected: its examples leave the library and their image copies are deleted from disk.
   - Pinned in Task 4, `test_withdrawing_the_style_withdraws_its_examples_and_files`.
5. **An image whose OCR is still processing.**
   - Expected: it is listed off, with the "couldn't read" sentence, and switching it on needs the second confirm.
   - Pinned in Task 5, `test_unread_image_needs_the_second_confirm`.
6. **A viewer who is not the author opens a pending example's image URL.**
   - Expected: 404. Pending items are visible to their author and admins only.
   - Pinned in Task 4, `test_pending_example_images_are_not_public`.

---

## File map

`S` = `api/services/journal_two`, `J` = `app/src/pages/journal-2-0`.

| File | Responsibility | Tasks |
|---|---|---|
| `docs/notebook/p3b-verify-before-building.md` + evidence | citations re-read, bytes measured | 1 |
| `S/public_note_payload.py`, `S/example_sanitize.py` (new: text patterns, broker list), `tests/test_example_reduce.py` (new) | the `example` mode and the change list | 2 |
| `S/template_gallery.py`, `api/routers/notebook_template_gallery.py`, `tests/test_example_notes.py` (new) | preview, publish, held revisions, the style link | 3 |
| `S/template_gallery.py` (image copy, withdraw, purge), the image route, the account purge, `tests/test_example_note_images.py` (new) | image copies and their lifecycle | 4 |
| `J/components/notebook/library/ExamplePreviewSheet.jsx` (new), `ExampleNotePicker.jsx` (new), `J/lib/styleLibrary.js` (lazy calls), `ShareStyleForm.jsx`, the style item page, tests | the author's preview and door | 5 |
| the style item page, the admin preview | showing examples to browsers and reviewers | 6 |
| `tools/notebook_contract_fixtures.py`, fixtures, `docs/feature_flags.json` | contract fixtures and the ledger entry | 7 |
| a11y, `tools/notebook_example_notes_walk.py` (new), evidence | a11y, walk, bytes | 8 |
| `docs/notebook/p3b-arming.md`, PR | gate, review, PR, arming | 9 |

---

### Task 1: Verify before building

**Files:** Create `docs/notebook/p3b-verify-before-building.md` and `docs/notebook/evidence/p3b-verify-<run-id>/`.

- [ ] **Step 1: Make the worktree.**
  ```bash
  cd /c/Users/Patrick/uct-dashboard && git fetch origin && git worktree add -b notebook-p3b-examples /c/Users/Patrick/uct-worktrees/notebook-p3b origin/master
  printf 'session: 61625d99-f8db-4269-a728-231c08d3da11\ncreated: 2026-10-17\n' > /c/Users/Patrick/uct-worktrees/notebook-p3b/.uct-session-owner
  ls -A /c/Users/Patrick/uct-worktrees/_nb-shared-install/node_modules | wc -l
  ```
  The last line must print `377`. Then, from PowerShell:
  ```powershell
  New-Item -ItemType Junction -Path 'C:\Users\Patrick\uct-worktrees\notebook-p3b\app\node_modules' -Target 'C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules'
  ```
  Confirm P3a is on the base: `git merge-base --is-ancestor <P3a merge SHA> HEAD`. If it is not, stop.
- [ ] **Step 2: Record the base reds.** Each file runs in its own call.
  - Pytest: `tests/test_public_note_payload.py`, `tests/test_style_library.py`, `tests/test_notebook_template_gallery.py`, `tests/test_j2_db_import_closure.py`, the account purge test.
  - Vitest: the library UI tests P3a added, plus `reachable.test.js` and `tapFloor.test.js`.
- [ ] **Step 3: Answer V1–V10, each with a quoted line.**

  | V | Question | Where |
  |---|---|---|
  | V1 | Base SHA, and P3a's merge SHA | git |
  | V2 | `reduce`'s signature, `MODES`, how `gallery` mode is branched, `NODE_POLICY` rows for image/figure/linkCard/taskItem | `S/public_note_payload.py` |
  | V3 | How a pasted image's `src` maps to its stored file and its document id (`/api/j2/notes/attachments/...`), and `attachment_root` | `S/attachment_root.py`, `_ATTACHMENT_PREFIX` (`public_note_payload.py:158`) |
  | V4 | `document_ocr.document_text_state` / `page_transcript` return shapes for an image document | `S/document_ocr.py:467,927` |
  | V5 | `trader_blocks.BLOCK_IDS` + `BUILDERS` (empty params per id) | `S/trader_blocks.py` |
  | V6 | Where broker institution names are stored for a member | `S/broker/*`, `j2_broker_accounts` |
  | V7 | P3a's `publish_style`, held revisions, `withdraw`, `get_item` payload, admin preview, `capabilities` (if any) in the list response | `S/template_gallery.py`, router |
  | V8 | P3a's `ShareStyleForm` + style item page component names and props | `J/components/notebook/library/` (or wherever P3a put them) |
  | V9 | The account purge's direct and indirect tables for gallery rows | purge module |
  | V10 (**measured**) | First-open closure on the base | `python tools/notebook_perf_budgets.py --dist app/dist` |

- [ ] **Step 4: Commit and push.** Message: `docs(notebook): P3b verify-before-building (V1-V10, bytes measured)`.

---

### Task 2: The `example` reducer mode and the change list

**Files:**
- Create: `S/example_sanitize.py`, `tests/test_example_reduce.py`
- Modify: `S/public_note_payload.py`

**Interfaces (produces):**
```python
# S/example_sanitize.py -- pure, no imports beyond re/unicodedata.
BROKER_NAMES: tuple[str, ...] = (
    "Charles Schwab", "Schwab", "Fidelity", "Interactive Brokers", "IBKR", "Robinhood", "Webull",
    "E*TRADE", "ETRADE", "TD Ameritrade", "tastytrade", "tastyworks", "TradeStation", "Lightspeed",
    "Cobra Trading", "Vanguard", "Merrill Edge", "Merrill", "SoFi Invest", "Public.com", "Firstrade",
    "Ally Invest", "Moomoo", "Tradier", "Centerpoint", "Cobra",
)
VALUE_TEXT = "your value here"
BROKER_TEXT = "your broker"
def scrub_text(text: str, brokers: tuple[str, ...], changes: list | None) -> str
def ocr_warnings(text: str, brokers: tuple[str, ...]) -> list[dict]   # [{kind: 'money'|'digits'|'broker', match: str}]
```

```python
# public_note_payload.py
MODES = ("share", "publish", "gallery", "example")
def reduce(body, mode, *, ..., images_on: frozenset[str] = frozenset(), brokers: tuple[str, ...] = (),
           image_src_for=None, report: list | None = None)
```
- `images_on` holds the original `src` values the author switched on.
- `image_src_for(src) -> str` returns the rewritten public URL.
- Use the existing keyword names V2 records, and add only these.

Matching rules:
- Brokers match whole words, case-insensitive. Longest first, so "Charles Schwab" wins over "Schwab".
- Money: `(?<![\w$])[+-]?\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?[kKmM]?\b|(?<![\w$])[+-]?\$\s?\d+(?:\.\d+)?[kKmM]?\b`.
- P&L figure: `[+-]?\d+(?:\.\d+)?\s?(?:R|%)\b`, and only when one of `pnl|p&l|profit|loss|up|down|made|lost|gain|gained` is within the 3 words before it.
- Digit runs (OCR only): `\d{6,}`, after removing spaces and dashes inside the run.

- [ ] **Step 1: Write the failing tests.** Each R-P3b-3 row is one test:
  1. **`test_money_pnl_and_broker_in_one_sentence`**:
     - input "made $1,240 on NVDA, up 3.2R, at Schwab";
     - output "made your value here on NVDA, up your value here, at your broker";
     - 3 change entries, of kinds money, pnl_figure and broker.
  2. "NVDA 132.40 support" is unchanged.
  3. "-$500k" and "$2.5M" are each one money entry.
  4. "Charles Schwab" produces one broker entry, not two.
  5. "Down 4% today" is replaced. "RS up 4% vs SPY" is replaced too: "up" is within 3 words before. The case is accepted and documented, because the preview shows it.
  6. A `positionSizing` block with `accountSize: 25000` comes out with exactly `BUILDERS['positionSizing']`'s empty params, plus a `block_reset` entry.
  7. A `tradeReview` block's `tradeId` is emptied.
  8. A `financialFact` node becomes the text `your value here`.
  9. A `chart` embed becomes the neutral line.
  10. A `notebook` embed is dropped.
  11. A `tradeRef` attr is removed and the node is kept.
  12. An image not in `images_on` is dropped, with an `image_off` entry. An image in `images_on` keeps its node with `src = image_src_for(src)`.
  13. Task items come out unchecked.
  14. An email becomes `email address`.
  15. `noteLink` becomes `linked note`.
  16. The other three modes are byte-identical before and after. Golden: reduce every fixture in `tests/test_public_note_payload.py` in each old mode, and compare with the values captured on the base in Step 2.
  17. `report=None` gives the same body as with a list.
  18. `ocr_warnings("Acct 12345678 bal $48,210 Fidelity")` returns digits, money and broker.
  19. The module imports no web framework (the existing closure rail stays green).
- [ ] **Step 2: Capture the old-mode goldens on the base** into a test fixture file. Run each existing payload fixture through `share`, `publish` and `gallery`, and save the results. Then run all the new tests and watch them fail.
- [ ] **Step 3: Implement.**
  - The `example` mode reuses `gallery`'s branches wherever the table above says "gallery's rule", through the same code path. Never a copy of it.
  - The text pass runs on text nodes only, after the existing email scrub.
- [ ] **Step 4: Run the new file plus `tests/test_public_note_payload.py` and `tests/test_j2_db_import_closure.py`.** Then mutation-prove two cases, restoring the file each time:
  - remove the longest-first broker sort, and test 4 fails;
  - remove the 3-word window, and test 2 or a "NVDA up" control fails. Add a control first: "NVDA 3.2R target" with no P&L word stays unchanged.
- [ ] **Step 5: Commit and push.** Message: `feat(notebook): example reducer mode with a change list - money, P&L, brokers, blocks, facts, images (P3b)`.

---

### Task 3: Preview, publish, held revisions, the style link

**Files:**
- Modify: `S/template_gallery.py`, `api/routers/notebook_template_gallery.py`
- Create: `tests/test_example_notes.py`

**Interfaces (produces):**
```python
ITEM_TYPES = ("outline", "style", "example_note")   # ⛔ ONE FACT IN TWO FILES with the client list (P3a's rail)
def example_enabled() -> bool                         # NOTEBOOK_EXAMPLE_NOTES_ENABLED and the library switch
def preview_example(conn, user_id, note_id, images_on: list[str]) -> dict
    # {"bodyJson": reduced, "changes": [{kind, before, after}], "counts": {kind: n},
    #  "images": [{"src", "name", "ocr": "ready"|"no_text"|"processing"|"unavailable", "warnings": [...]}]}
def publish_example(conn, user_id, note_id, style_item_id, images_on: list[str], title: str) -> dict
```

**Routes:**
- `POST /api/j2/template-gallery/examples/preview`, body `{noteId, imagesOn}`.
- `POST /api/j2/template-gallery/examples`, body `{noteId, styleItemId, imagesOn, title}`.
- Both are `require_paid`, both 404 when the switch is off, and both are declared before `/{gallery_id}`.
- Publish is rate-limited per R-P3b-8.

**Behaviour:**
- **Publish:**
  - reads the note from the DB, checks that the member owns it and that it is live, and reduces it itself;
  - stores `payload_json = {"bodyJson": reduced, "linkedItemId": style_item_id, "noteKind": kind}`;
  - stores `body_json`/`preview_json` the way P3a's style publish does;
  - writes `item_type='example_note'` and `status='pending'`;
  - never stores the change list's `before` text.
- **Publishing again:**
  - when this note already has an approved example for this style (same author, same `source_note_id`, a new column `source_note_id TEXT`, additive ALTER), the new version is held in `pending_json`, as P3a's R-P3-3 does for styles;
  - when it is not approved yet, the row is updated in place.
- **Refusals:**
  - a style item that is not the author's, or is withdrawn, gives 400 `Pick one of your own shared styles.`;
  - a note that is not the author's or not live gives 404;
  - a note whose kind is not the style's kind gives 400 `This note is a different kind from the style.`

- [ ] **Step 1: Write the failing tests:**
  1. The preview returns the reduced body, counts by kind, and the image list with OCR states. Stub `document_ocr` as V4 records.
  2. Publish stores a pending `example_note` linked to the style, and nothing of `before` appears anywhere in the row (search every column).
  3. **`test_publish_never_trusts_a_client_body`**: a request carrying an extra `bodyJson` field with "$9,999" stores the server's reduction.
  4. **`test_a_later_note_edit_never_reaches_the_example`**: edit the note through the notes service after publish, and the stored payload is unchanged.
  5. Publishing again on an approved example holds the new version in `pending_json`, and the listed one stays.
  6. The three refusals.
  7. The switch off gives 404 on both routes. With the library switch on and the example switch off, the routes are still 404 and the list shows `capabilities.exampleNotes == false`.
  8. Rate limit: the 11th publish in an hour gives 429 with the shared sentence.
  9. The client `ITEM_TYPES` parity rail (P3a's `_client_keys`) now includes `example_note`.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement.** The client `ITEM_TYPES` in P3a's lazy `styleLibrary.js` gains `{key: 'example_note', label: 'Example notes'}`. The library's type chips skip it (R-P3b-2): filter by `key !== 'example_note'` at the chip render, and do not drop it from the list.
- [ ] **Step 4: Run the new file, `tests/test_style_library.py` and `tests/test_notebook_template_gallery.py`.**
- [ ] **Step 5: Commit and push.** Message: `feat(notebook): example note preview and publish, held revisions, linked to a style (P3b)`.

---

### Task 4: Image copies and their lifecycle

**Files:**
- Modify: `S/template_gallery.py`, the router, the account purge module
- Create: `tests/test_example_note_images.py`

**Interfaces:**
- Images are copied during `publish_example`, after the reduce. A failed copy fails the publish with 500 `Couldn't copy an image. Nothing was shared.` and removes any partial copies, so it is all or nothing.
- `GET /api/j2/template-gallery/{item_id}/images/{n}`:
  - serves the file with `PUBLIC_HEADERS` + `IMAGE_HEADERS` when the item is approved, listed and not hidden, or when the viewer is its author or an admin;
  - otherwise 404 (`not_found()`).
- Withdrawing a style withdraws its examples (status as P3a's withdraw sets) and deletes their directories. Withdrawing an example deletes its directory.
- Account purge deletes the member's example rows and directories.
- A replaced pending revision's new copies live in `<item_id>/v<version>/`. Approval moves them in place of the old ones and deletes the old ones. Rejection deletes the new ones.

- [ ] **Step 1: Write the failing tests.** Use a tmp `attachment_root`.
  1. Two switched-on images are copied, and one switched-off image is not.
  2. A 7th image gives 400 with R-P3b-7's sentence. A GIF gives 400 `Only PNG, JPEG or WebP images can be shared.`
  3. **`test_pending_example_images_are_not_public`**: another paid member gets 404. The author gets 200. An admin gets 200.
  4. An approved item serves to any paid member with every public header.
  5. **`test_withdrawing_the_style_withdraws_its_examples_and_files`**.
  6. Purge removes rows and files for that member only.
  7. A copy failure leaves no directory behind. Inject a failing copy function.
  8. Approve and reject of a held revision move or delete the right files.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement.** Files are written by temp-then-`os.replace`. Never `open('w')` on the final path.
- [ ] **Step 4: Run the new file plus Task 3's file and the purge test.** Mutation-prove case 3: drop the status check, and case 3 fails. Restore the file.
- [ ] **Step 5: Commit and push.** Message: `feat(notebook): example note image copies - served with public headers, removed on withdraw and purge (P3b)`.

---

### Task 5: The author's door and preview sheet

**Files:**
- Create: `ExampleNotePicker.jsx`, `ExamplePreviewSheet.jsx` (+ CSS + tests), in the library directory V8 names
- Modify: P3a's `ShareStyleForm.jsx`, the style item page (author view), and `J/lib/styleLibrary.js` (lazy calls `previewExample`, `publishExample`)

**Behaviour:**
- **`Add an example note`** shows only when `capabilities.exampleNotes`. It opens the picker:
  - the author's live notes of the style's kind (from the existing notes list call, filtered by kind);
  - a search box;
  - each row is a button labelled with the note title and date.
- **`ExamplePreviewSheet`** is a `Sheet` titled `Preview your example`.
  - **Top:** counts by kind as one sentence, for example `3 amounts, 1 broker name and 2 blocks were replaced. Here is exactly what other members will see.`
  - **Middle:** the reduced body, rendered read-only by the same renderer the library uses for a style's outline preview (V8). Each replaced span carries `data-replaced` and a dotted underline, and its accessible description is the `kind` in words.
  - **Images:** one row per image, with a thumbnail of the author's own image (their own URL; this is their own view), its OCR line, and a switch `Share this image`, off by default.
    - Switching on an image that has warnings, or that is unread, opens the second confirm (R-P3b-5).
    - Each switch re-runs the preview, so the body shows the image in place.
  - **Bottom:** a title field (prefilled with the note title) and two buttons, `Submit for review` and `Cancel`.
    - On success: `Sent for review. It will show on your style once approved.`
    - On failure: the server's sentence, with the sheet kept open.

- [ ] **Step 1: Write the failing tests:**
  1. With `capabilities.exampleNotes` false, there is no door.
  2. The picker lists only notes of the style's kind.
  3. The sheet shows the counts sentence and the replaced spans.
  4. Every image switch starts off.
  5. **`test_unread_image_needs_the_second_confirm`**: an image with `ocr: 'processing'` shows the couldn't-read sentence, and switching it on asks the second question. Cancelling leaves it off.
  6. Submit posts `{noteId, styleItemId, imagesOn, title}` and never a body. Spy on fetch.
  7. A failed submit keeps the sheet open with the sentence.
  8. Every control has an accessible name, and the targets are ≥44 px on touch.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests plus `reachable.test.js`, `tapFloor.test.js` and `keyListenerCensus.test.js`.**
- [ ] **Step 5: Commit and push.** Message: `feat(notebook): add an example note - picker and the exact-public preview with per-image opt-in (P3b)`.

---

### Task 6: Browsers and reviewers see the examples

**Files:** Modify P3a's style item page, `S/template_gallery.py` (`get_item` adds `examples`), and the admin preview (V7).

**Behaviour:**
- `get_item` for a style returns `examples`: up to 3 approved, listed, non-hidden example items, newest first, each with `id`, `title`, `bodyJson` and `updatedAt`. It never includes `pending_json`.
- The item page shows a section `In use`, with one card per example rendering `bodyJson` read-only. Images load from the gallery image route.
- A style with no examples shows no section.
- The admin review of an `example_note` shows the stored reduced body and its images exactly as a member would see them, plus the linked style's title.

- [ ] **Step 1: Write the failing tests:**
  - server:
    - `examples` holds approved ones only, at most 3, newest first;
    - a hidden example is excluded;
  - client:
    - the section renders;
    - an image `src` points at the gallery route;
    - no section with no examples;
  - admin:
    - the preview renders the reduced body.
- [ ] **Step 2: Run them, and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.**
- [ ] **Step 5: Commit and push.** Message: `feat(notebook): styles show their approved example notes; reviewers see exactly the public copy (P3b)`.

---

### Task 7: Contract fixtures and the ledger

- [ ] **Step 1:** Add fixtures for the preview, publish, image and item routes (`examples`) through `tools/notebook_contract_fixtures.py`.
- [ ] **Step 2:** Add a `docs/feature_flags.json` entry for `NOTEBOOK_EXAMPLE_NOTES_ENABLED` with `status: dark`, `where: web`, and this note:
  > P3b. Server-only (no client fallback row); gates example-note preview, publish and the In use section. Needs NOTEBOOK_STYLE_LIBRARY_ENABLED. Arm: railway variables --service web --set NOTEBOOK_EXAMPLE_NOTES_ENABLED=1 (the owner's). Rollback: 0; stored examples stay stored and unlisted.
- [ ] **Step 3:** Run `tests/test_feature_flag_ledger.py` and the contract tests. Commit and push. Message: `test(notebook): example notes contract fixtures and flag ledger entry (P3b)`.

---

### Task 8: Accessibility, the walk, and bytes

- [ ] **Step 1:** Add axe recipes for the picker, the preview sheet (with replaced spans and image rows) and the `In use` section.
- [ ] **Step 2:** Write `tools/notebook_example_notes_walk.py`, in P3a's walk shape. Its sandbox env has both switches on.
  1. Write a trade plan note containing "made $1,240 at Schwab", a position sizing block with an account size, and one pasted image.
  2. Share its style (P3a flow) and add the note as an example.
  3. Read the preview's counts sentence. Confirm the replaced spans and that the image is off.
  4. Switch the image on through the second confirm, and submit.
  5. As admin, approve it.
  6. As a second paid account, open the style. The `In use` section shows "your value here" and "your broker", and the image loads.
  7. Withdraw the style. The image URL now answers 404.

  Run at 1280, 820 and 390. Commit the raw output first.
- [ ] **Step 3:** Bytes: the closure equals V10 (+0 B). Commit the raw output.
- [ ] **Step 4:** Commit and push. Message: `test(notebook): example notes a11y, walk and bytes evidence (P3b)`.

---

### Task 9: Gate, review, PR, arming

Same steps as P3a Task 12, with the arming packet `docs/notebook/p3b-arming.md`. After arming, check:
1. the list shows `capabilities.exampleNotes`;
2. the smoke account previews a note with "$100" and sees one money change;
3. it does not submit;
4. nothing is left behind.

---

## Self-review (done at write time)

1. **Spec coverage:**
   - §P3.1, example note linked to a style: R-P3b-2, Tasks 3 and 6.
   - §P3.2:
     - mandatory sanitizing shown before publish: Tasks 2 and 5;
     - the strip list (account sizes, P&L, brokers, linked trades, rule evidence, facts): R-P3b-3;
     - images off by default, switched on one by one: Task 5;
     - OCR warning on amounts, digit runs and brokers: R-P3b-5;
     - review queue: Tasks 3 and 6.
   - §P3.3, item page shows the example note: Task 6.
   - §P3.4:
     - paid-gated: every route;
     - vendor rulings: market data becomes the neutral line;
     - rate limits: R-P3b-8;
     - dark: R-P3b-6.
   - §6:
     - bytes 0;
     - a11y;
     - privacy (server re-reduces, `before` never stored);
     - rollback via the switch;
     - ONE-FACT for `ITEM_TYPES`.
2. **Placeholders:** none. Where a P3a name is needed, V7 and V8 read it.
3. **Names used the same everywhere:** `example`, `example_note`, `scrub_text`, `ocr_warnings`, `preview_example`, `publish_example`, `example_enabled`, `capabilities.exampleNotes`, `ExamplePreviewSheet`, `ExampleNotePicker`.
4. **Review Focus:** each line has its named test.
