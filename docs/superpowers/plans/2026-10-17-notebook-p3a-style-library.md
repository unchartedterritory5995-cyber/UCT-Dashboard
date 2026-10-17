# Notebook P3a: the Community Style Library (styles + outlines) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members can share a journal style to the existing community gallery, browse it by trading style, kind and popularity, adopt a style as their own copy (credited, optionally "notify me when the author updates"), mark items Helpful, open an author's page and follow them, and accept an author's update as an explicit, previewed merge that never removes their own edits. All of it is dark behind `NOTEBOOK_STYLE_LIBRARY_ENABLED`.

**Architecture:**
- **One gallery, two item types.** `j2_template_gallery` gains `item_type` (`outline` default, `style`), `payload_json`, `version`, `trading_style`, `source_style_id`, `pending_json`, `pending_at` (additive ALTERs in `ensure_gallery_schema`, the `preview_json` precedent). Every existing row reads as an outline. The review queue, hide, report, unpublish and firm-seed machinery is reused unchanged.
- **A style item is a portable payload, built and reduced by the server.** `style_payload` reads the member's own style and returns `{kindId, outlineBodyJson, blocks, properties}`: a built-in kind only, the outline inlined from the style or its template and passed through the gallery reducer, blocks verbatim (settings are enum values), and only built-in user-set property defaults. The client never sends a body.
- **Adopt is `journal_styles.create_style` plus the two columns P1 already made.** `source_gallery_id` and `source_version` (`db.py:2047-2048`) are written for the first time. An optional watch row records "notify me".
- **An author update is held, not swapped.** Publishing again to an approved style item writes `pending_json` and leaves the approved version listed. Approval swaps it in, bumps `version`, and rings one notice per watcher. "Update my copy" is `plan_update` + `apply_update`: additive only, outline replaced only on an explicit tick (ruling P3-8).
- **Authors are opaque handles.** `j2_gallery_authors(user_id, handle)` mints a random handle on first need. Pages, follows and the feed are keyed by handle. No user id or email ever leaves (`template_gallery.py:30-33`).
- **All UI lives in already-lazy chunks.** The library is the lazy `TemplateGallery` dialog. New doors live inside lazy `StyleSurfaces` / `StylesManager`. Client lists live in a new lazy-only `lib/styleLibrary.js`. The first-open closure gains only one `FLAG_FALLBACKS` row and two telemetry names.

**Tech Stack:** FastAPI + SQLite (`auth.db`, `j2_` tables), React + Vite, vitest + Testing Library, pytest, Python Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md` §P3 (lines 285-329), §6 cross-cutting (361-378), §7 decisions 3, 4 and 6 (386-391). Code map: `C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\61625d99-f8db-4269-a728-231c08d3da11\scratchpad\p3-code-map.md`. Model plan (shape, rails, constraints): `docs/superpowers/plans/2026-10-15-notebook-p2-tier2-part-b.md`.

**Base:** `origin/master` at the time Task 1 runs (it carries #346, #349, #353, #363, #366). One integration worktree `C:\Users\Patrick\uct-worktrees\notebook-p3a`, branch `notebook-p3a-library`, written with a `.uct-session-owner` file. Tasks run one at a time: Tasks 3-7 share `template_gallery.py`, Tasks 9-10 share `TemplateGallery.jsx`.

Every `file:line` below was read on `b7aff58874` when this plan was written. Each is a dated claim; Task 1 re-reads them on the base.

## Rulings this plan makes (each is also in the ledger and the PR body)

Each reads **Ruling: what. Why. Cost if wrong.**

- **R-P3-1, the split.** P3a ships outline + style items, adopt, Helpful, trending, trading style, authors, follow, feed, versioning and notify-me. P3b ships example notes with the sanitizer preview and per-image opt-in. `page_layout` ships with P4. Why: example notes carry the data-leak risk and deserve their own review and gate. Cost if wrong: two deploys instead of one.
- **R-P3-2, author identity.** An opaque per-author handle (`secrets.token_urlsafe(9)`, unique) is the only author key that leaves the server. A page lists only approved, listed, non-hidden items under the display name the gallery already shows (`_author_label`, `template_gallery.py:327-333`). Firm items have no handle. Why: keeps "never an email, never an id" while making follow possible. Cost if wrong: a handle migration later.
- **R-P3-3, versions.** An approved style item updated by its author keeps its approved version listed; the new version waits in `pending_json` (a pending revision). Approval swaps it in and bumps `version`. A rejected revision leaves the listed version untouched and carries the reviewer's note to the author. Why: the in-place reset (`:552-559`) would make every author fix a delisting. Cost if wrong: a column nobody uses.
- **R-P3-4, trading style.** A new optional field `trading_style` in `swing|day|prop|options|earnings|long_term`, beside the existing document `category`. It is a ONE FACT IN TWO FILES pair with the client's `TRADING_STYLES`. Why: `CATEGORIES` already means kind of document, and existing rows use it. Cost if wrong: one more filter row.
- **R-P3-5, bytes.** Allowance for the whole of P3a: **+400 B** over the tip measured in Task 1 (expected 2,259,916 B). That gives a ceiling of the tip + 400 B, under the budget 2,260,793 B. The only first-open additions allowed are the `FLAG_FALLBACKS` row and the two telemetry names with their schemas. Why: 877 B of headroom is shared by P4, P5 and Tier 3. Cost if wrong: a trim task (Task 11 Step 4 names the fallback).
- **R-P3-6, versioning scope.** Pending revisions apply to style items only. Outline items keep today's publish-again-goes-to-pending rule. Why: changing the armed outline gallery's live behaviour is out of a dark plan's reach, and outline adopts have no source link to notify. Cost if wrong: outline authors still see a fix delist until review.
- **R-P3-7, no Notebook tab.** The library is the lazy `TemplateGallery` dialog. It is reached from the TemplatePicker door (exists, `TemplatePicker.jsx:333-345`), a new "Browse community styles" door in `KindSection` (inside lazy `StyleSurfaces`) and a "Community" button in the Styles manager (lazy). Why: `NotebookTab.jsx` is eager, and each `import()` there costs ~265 B. Cost if wrong: one more click; a tab can follow once headroom is freed.
- **R-P3-8, the update merge.** "Update my copy" adds the blocks and built-in property defaults the member does not have and sets `source_version`. It never changes a block's settings and never removes anything. It replaces the outline only when the member ticks "Use the author's new outline" (default off). Why: the spec's "an explicit, previewed merge that never removes your edits". Cost if wrong: a member who wanted the new outline ticks one box.
- **R-P3-9, a portable style.** Publishing a style whose kind is the member's own (not built-in) is refused with "Only styles for a built-in kind of note can be shared yet." Member-property defaults are dropped from the payload, and the preview says "Your own property defaults are not shared." Why: another member cannot receive someone else's kind or property ids. Cost if wrong: a member with a custom kind cannot share it until a later plan maps kinds.
- **R-P3-10, two switches for adopt.** Adopt needs `NOTEBOOK_STYLE_LIBRARY_ENABLED` AND `NOTEBOOK_JOURNAL_STYLES_ENABLED` (armed on web since 2026-10-14), because adopt creates a style row. With the library switch off, the list returns outline items only and every style route answers the one 404. Why: the flag gates creating, never rendering, and a library-off pod must look exactly like today. Cost if wrong: none found.
- **R-P3-11, rate limits.** Adopt: 30/hour in-process plus a durable 50/day (`notebook_gallery_adopt`). Helpful and follow: 60/hour each, in-process only (cheap, idempotent rows). Style publish shares the existing publish scopes (10/hour, durable 10/day). Why: the gallery's own split (`notebook_template_gallery.py:49-54`). Cost if wrong: a member adopting 51 styles in a day waits until tomorrow.

## Owner decisions this plan surfaces (none blocks the build)

- **O-P3-1.** Arming `NOTEBOOK_STYLE_LIBRARY_ENABLED` on `web` after the PR is live. Task 12 hands over the command and the checks.
- **O-P3-2.** UCT picks for styles: firm-seeded style items need payloads written by the team (the P5 starter packs). P3a ships the machinery and zero firm style rows. Recommended: author them in P5.

## Global Constraints

Part B's Global Constraints apply unchanged (`docs/superpowers/plans/2026-10-15-notebook-p2-tier2-part-b.md`, "Global Constraints"). Restated, with this plan's values:

- **Worktree.** Everything runs in `$WT = C:\Users\Patrick\uct-worktrees\notebook-p3a`. `app/node_modules` is a junction to `C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules`.
  - Make the junction only after `ls -A` counts **377** entries in the target.
  - Remove it only with `cmd /c rmdir` from PowerShell, after `Get-Item -Force` shows `LinkType` = `Junction`. Then re-count 377.
- **Zero schema bumps.** No new note node type and no new node attribute. A style payload holds existing node types only. A task that finds it needs one STOPS and reports.
- **The integrity rule** (spec lines 226-232). No second write door into a note.
  - Adopt and update write `j2_journal_styles` rows only, through `journal_styles.create_style` / `update_style`. Neither writes a note.
  - `J/lib/offline/doorEnumeration.test.js` stays `MODE = 'fail'` and green.
- **The gallery's rules stay** (`template_gallery.py:9-46`):
  - one reducer (`public_note_payload.reduce`, mode `gallery`);
  - definitions never values;
  - the display name only;
  - hide is a visibility state, never a delete;
  - unpublish deletes only the author's own copy.
- **Server owns every rule.** The client sends ids and form fields, never a body or a payload.
- **No new `document` or `window` key listener** (`app/src/pages/command/keyListenerCensus.test.js`).
- **iOS 16 floor.** No regex lookbehind in client code; no `Iterator` helpers or `Promise.withResolvers` without the existing shims.
- **Bytes.** The first-open closure (`python tools/notebook_perf_budgets.py --dist app/dist`) stays at or under Task 1's tip + **400 B** (R-P3-5). Every new surface is a lazy chunk. The budget is never raised.
- **Copy.** Plain English, no emoji, `UIcon` names only.
  - A refusal is a fixed sentence, never a raw server `detail` (`rawErrorSurface.test.js`). The gallery's own fixed sentences may be shown, as `TemplateGallery.jsx` already does.
  - A toast or line says what happened and what did not ("Nothing was changed.").
- **Touch.** Every new control meets `var(--tap-min)` (44 px) at or below 1,024 px (`app/src/styles/tapFloor.test.js`). Breakpoints are 640 and 1,024 only.
- **Rails that must stay green:**
  - `J/lib/offline/doorEnumeration.test.js`
  - `app/src/pages/command/keyListenerCensus.test.js`
  - `app/src/components/screener/reachable.test.js`
  - `app/src/styles/tapFloor.test.js`
  - `rawErrorSurface.test.js`
  - `J/lib/swallowedFetch.census.test.js`
  - `NoteEditorPage.styleChunks.test.js` (it pins exactly two `import()`s of `styles/` modules; this plan adds none outside `styles/`)
  - the a11y population in `J/a11y/notebookSurfaces.js` with its coverage rail
  - `tests/test_journal_two_account_purge.py`
  - `tests/test_notebook_contract_fixtures.py`
  - `tests/test_paywall_gate_free_tier.py`
- **Tests.**
  - Backend pytest by named files only (`python -m pytest tests/test_a.py tests/test_b.py -q`), never `tests/` and never `-k` alone.
  - Vitest by named files from `$WT/app`.
  - Each verification runs in its own tool call, captures `code=$?` and exits with it, with no pipe and no trailing `echo`.
  - Read the totals line, then commit in a separate call.
- **Commits.**
  - Run `python tools/check_repo_hygiene.py --staged` in its own call, then `git commit -F - -- <paths>` with a quoted heredoc, never `-m`.
  - The message ends with exactly these trailer lines:
    ```
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01RcrmLhik6b62vYrvrYWxxs
    ```
  - Push the branch after every task. Never `--no-verify`. Never `git add -A`.
- **Evidence.** Every walk, bytes and a11y run writes its raw output under `docs/notebook/evidence/p3a-<run-id>/`. It is committed BEFORE any summary is written (R-RAW).
- **Gate and walk.** The six-shard gate runs in a SEPARATE worktree on a `notebook-*` branch. The walk runs at 1280 / 820 / 390.
- **Flags in production are the owner's.** No agent runs `railway variables --set` or `railway variable delete`.

## Review Focus

These are the input classes the spec implies, most likely first. Each is pinned by a test in the task that owns the code.

1. **A style whose outline holds the author's private words, links or images.**
   - Expected: the published payload has no image, no note link, no email and no in-app address. A market-data embed becomes the neutral line. A task item is unchecked.
   - Pinned in Task 4: `test_a_published_style_payload_goes_through_the_gallery_reducer`.
2. **A style using the author's own kind or own properties.**
   - Own kind: publish is refused with R-P3-9's sentence.
   - Own property defaults: dropped, with the preview saying so.
   - Pinned in Task 4: `test_a_style_on_a_custom_kind_is_refused` and `test_member_property_defaults_never_travel`.
3. **An author updating an approved style while members have adopted it.**
   - The listed version is unchanged until approval.
   - After approval, each watcher gets exactly one notice.
   - A non-watcher gets none.
   - The adopter's own copy is untouched until they choose "Update my copy".
   - Pinned in Task 4: `test_an_approved_style_update_is_held_not_listed`. Pinned in Task 7: `test_an_approved_revision_rings_each_watcher_once`.
4. **The update merge against a heavily edited copy.**
   - The member removed a block, changed settings and rewrote the outline.
   - The merge re-adds no removed block, changes no setting, and leaves the outline unless ticked.
   - Pinned in Task 5: `test_update_never_removes_or_reverts_member_edits`.
5. **The author withdraws an item that members adopted.**
   - Every copy stays.
   - Each watcher gets one line: "<title> was taken down by its author. Your copy is yours and has not changed."
   - The watch rows are deleted.
   - Pinned in Task 7: `test_withdraw_keeps_copies_and_tells_watchers_once`.
6. **Library switch off on a pod that has style rows.**
   - The list shows outlines only.
   - Every style route answers 404.
   - Helpful, follow and feed answer 404.
   - Pinned in Task 3: `test_library_off_hides_every_style_row_and_route`.
7. **A deleted account.**
   - Its helpful marks, follows (both directions), handle and watches are removed.
   - Other members' adopted copies of its styles stay.
   - Pinned in Task 7: `test_account_purge_removes_library_rows_and_keeps_copies`.

---

## File map

`J` = `app/src/pages/journal-2-0`, `B` = `J/components/notebook`, `S` = `api/services/journal_two`.

| File | Responsibility | Tasks |
|---|---|---|
| `docs/notebook/p3a-verify-before-building.md` (new), `docs/notebook/evidence/p3a-verify-<run-id>/` | citations re-read; V1-V16 answered | 1 |
| `api/routers/auth.py`, `J/lib/offline/notebookFlags.js`, `J/lib/styleLibraryFlag.js` (new) + test, `tests/test_notebook_flags.py`, `tests/test_notebook_flag_parse.py`, `docs/feature_flags.json`, `tools/notebook_contract_fixtures.py` | the switch | 2 |
| `S/template_gallery.py` (schema, constants, list filters, trending, summary), `J/lib/styleLibrary.js` (new, lists only in this task), `tests/test_notebook_template_gallery.py`, `tests/test_style_library.py` (new) | item types, trading style, sorts, the gate on the list | 3 |
| `S/template_gallery.py` (`style_payload`, `publish_style`, the revision swap in `admin_act`), `api/routers/notebook_template_gallery.py` (`POST /styles`), `tests/test_style_library.py` | publishing a style; versions | 4 |
| `S/template_gallery.py` (`adopt_style`, `list_updates`, `plan_update`, `apply_update`), router (`/adopt`, `/updates`, `/updates/{style_id}` GET/POST), `tests/test_style_library_adopt.py` (new) | adopt, notify-me, update merge | 5 |
| `S/template_gallery.py` (`set_helpful`, `author_handle`, `author_page`, `set_follow`, `feed`), router, `tests/test_style_library_social.py` (new) | Helpful, authors, follow, feed | 6 |
| `S/template_gallery.py` (notices in `admin_act` and `unpublish`), `S/account_purge.py`, `docs/account-deletion-manifest.md`, `tests/test_style_library_notices.py` (new), `tests/test_journal_two_account_purge.py` | notices and account deletion | 7 |
| `tools/notebook_contract_fixtures.py`, `J/__fixtures__/contract/*.json` | contract fixtures and sweeps for every new route | 8 |
| `J/lib/styleLibrary.js` (calls + hooks), `B/TemplateGallery.jsx` + CSS, `B/StyleLibraryCard.jsx` (new), `B/AuthorView.jsx` (new), tests | the library UI inside the lazy gallery | 9 |
| `B/styles/KindSection.jsx`, `B/styles/StylesManager.jsx`, `B/styles/ShareStyleForm.jsx` (new), `B/styles/StyleUpdateSheet.jsx` (new), `app/src/components/admin/TemplateGalleryReviewPanel.jsx`, tests | the doors, share, update review, admin preview | 10 |
| `J/lib/notebookTelemetry.js`, `api/routers/journal_two.py` (allowlist + schemas), `J/a11y/notebookSurfaces.js`, `J/a11y/styleLibrary.a11y.test.jsx` (new), `tools/notebook_style_library_walk.py` (new), bytes | telemetry, a11y, walk, bytes | 11 |
| `docs/notebook/p3a-arming.md` (new), PR | gate, walk, PR, arming packet | 12 |

---

### Task 1: Verify before building

This task re-reads every citation on the base and changes no product code.

**Files:**
- Create: `docs/notebook/p3a-verify-before-building.md`, `docs/notebook/evidence/p3a-verify-<run-id>/`

**Interfaces:**
- Consumes: nothing.
- Produces: the doc. Each V-item is either:
  - "confirmed", with a quoted line and its `file:line`; or
  - "differs", with the real shape and the task text it changes.
  
  The controller rules on every "differs" before Task 2 is dispatched.

- [ ] **Step 1: Make the worktree**

```bash
cd /c/Users/Patrick/uct-dashboard && git fetch origin && git worktree add -b notebook-p3a-library /c/Users/Patrick/uct-worktrees/notebook-p3a origin/master
printf 'session: 61625d99-f8db-4269-a728-231c08d3da11\ncreated: 2026-10-17\n' > /c/Users/Patrick/uct-worktrees/notebook-p3a/.uct-session-owner
ls -A /c/Users/Patrick/uct-worktrees/_nb-shared-install/node_modules | wc -l
```
Expected: the last line prints `377`. Then make the junction from PowerShell:
```powershell
New-Item -ItemType Junction -Path 'C:\Users\Patrick\uct-worktrees\notebook-p3a\app\node_modules' -Target 'C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules'
```

- [ ] **Step 2: Record the base reds**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a/app && npx vitest run src/pages/journal-2-0/components/notebook/TemplateGallery.test.jsx src/components/admin/TemplateGalleryReviewPanel.test.jsx src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/pages/command/keyListenerCensus.test.js src/components/screener/reachable.test.js src/pages/journal-2-0/components/notebook/NoteEditorPage.styleChunks.test.js > /tmp/p3a-base.log 2>&1; code=$?; tail -5 /tmp/p3a-base.log; exit $code
```
```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a && python -m pytest tests/test_notebook_template_gallery.py tests/test_journal_styles_store.py tests/test_journal_two_account_purge.py tests/test_notebook_contract_fixtures.py tests/test_notebook_flags.py tests/test_notebook_flag_parse.py tests/test_notebook_telemetry_events.py tests/test_j2_telemetry_allowlist.py -q > /tmp/p3a-base-py.log 2>&1; code=$?; tail -3 /tmp/p3a-base-py.log; exit $code
```
If a named file does not exist, the run reports it. Record the real file name in the doc and use it in later tasks. Record any red, with its first assertion line, as "pre-existing at <base sha>".

- [ ] **Step 3: Answer V1-V16 in the doc, each with a quoted line**

| V | Question | Where to look |
|---|---|---|
| V1 | Base SHA; the flag rows Part B added (`git log -S NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED --oneline`), as the template for Task 2's file list | git |
| V2 | `ensure_gallery_schema` and its ALTER loop, exactly as Task 3 extends it | `S/template_gallery.py:183-203` |
| V3 | `_SELECT_LIST` and its `assert` | `S/template_gallery.py:417-431` |
| V4 | `publish`'s update branch (the reset to pending) | `S/template_gallery.py:548-570` |
| V5 | `admin_act`'s approve branch and its `reviewed_updated_at` guard | `S/template_gallery.py:735-797` |
| V6 | `journal_styles.create_style`, `update_style` (does a content change bump `version`?), `get_style(full=True)` shape, `MAX_STYLES_PER_MEMBER`, `_clean_kind`, `_clean_properties`, `BUILTIN_STYLES` keys, `BUILTIN_PREFIX` | `S/journal_styles.py:43-48`, `:203-223`, `:235-238`, `:316-345`, `:412-500` |
| V7 | `note_kinds.get_kind` and how a built-in kind is told from a member kind (`BUILTIN_NOTE_KINDS` ids) | `S/note_kinds.py` |
| V8 | `note_properties.BUILTIN_USER_SET_IDS`, `is_builtin_property_id` | `S/note_properties.py:73-126` |
| V9 | `journal_styles.preview(user_id, {"style": {...}})` accepts a draft with `kindId, outlineBodyJson, blocks, properties` and writes nothing; the client door that calls it (`POST /api/j2/journal-styles/preview`) and its client function name | `S/journal_styles.py:919-`, `api/routers/notebook_journal_styles.py`, `J/lib/journalStyles.js` |
| V10 | `alerts.add_alert(alert_type, title, message, severity=None, data=None, user_id=None)` signature; how `NoticesBox` turns an alert into a line and a link (`data.research_url`?) | `api/services/alerts.py:382`, `J/lib/notices.js` |
| V11 | `account_purge._DIRECT_USER_TABLES` and the indirect-join block, and how `docs/account-deletion-manifest.md` is regenerated | `S/account_purge.py:161-163`, `:330-345`, the manifest header |
| V12 | `tools/notebook_contract_fixtures.py` `template_gallery(w)` and the sweep files that list gallery routes | `tools/notebook_contract_fixtures.py:1310`, `J/__fixtures__/contract/sweep.*.json` |
| V13 | `TemplateGallery.jsx` view chips, `GalleryCard` props, `openPreview`; where `TemplatePicker` mounts it and with which props | `B/TemplateGallery.jsx:89-160`, `:242-424`, `B/TemplatePicker.jsx:242-254`, `:333-345` |
| V14 | `KindSection.jsx` and `StylesManager.jsx`: which chunk each lives in (`styles/lazyStyles.js` → `StyleSurfaces.js`), and the props each takes | `B/styles/` |
| V15 | `notebookTelemetry.js` is in the first-open closure (Vite manifest), and its `NOTEBOOK_EVENTS` / `EVENT_SCHEMAS` shapes; server `_J2_TELEMETRY_EVENTS` / `_NOTEBOOK_PROP_SCHEMAS` | `J/lib/notebookTelemetry.js:35-90`, `api/routers/journal_two.py:162-320` |
| V16 (**measured**) | The first-open closure on the base: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected 2,259,916 B. Record the number. It is the base for R-P3-5's ceiling | build |

- [ ] **Step 4: Commit the doc and the raw bytes output**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a && git add docs/notebook/p3a-verify-before-building.md docs/notebook/evidence && python tools/check_repo_hygiene.py --staged
```
```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a && git commit -F - -- docs/notebook/p3a-verify-before-building.md docs/notebook/evidence <<'MSG'
docs(notebook): P3a verify-before-building (V1-V16, bytes measured)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RcrmLhik6b62vYrvrYWxxs
MSG
git push -u origin notebook-p3a-library
```

---

### Task 2: The `NOTEBOOK_STYLE_LIBRARY_ENABLED` switch

**Files:**
- Modify:
  - `api/routers/auth.py` (`NOTEBOOK_FLAGS`, after the `NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED` row)
  - `J/lib/offline/notebookFlags.js` (`FLAG_FALLBACKS`)
  - `tests/test_notebook_flags.py` (`NOTEBOOK_KEYS`)
  - `tests/test_notebook_flag_parse.py` (the gate map; follow V1's rows)
  - `docs/feature_flags.json`
  - `tools/notebook_contract_fixtures.py` (`FLAGS`)
- Create: `J/lib/styleLibraryFlag.js`, `J/lib/styleLibraryFlag.test.js`
- Service gate: `S/template_gallery.py` gets `LIBRARY_FLAG` and `library_enabled()` in Task 3; this task adds only the payload row and client helper.

**Interfaces:**
- Produces:
  - payload key `notebook_style_library_enabled`;
  - client helper `styleLibraryEnabled(): boolean` from `J/lib/styleLibraryFlag.js`.

- [ ] **Step 1: Write the failing client test**

`J/lib/styleLibraryFlag.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import { latchNotebookFlags, __resetNotebookFlagsForTests } from './offline/notebookFlags'
import { styleLibraryEnabled, STYLE_LIBRARY_FLAG } from './styleLibraryFlag'

describe('styleLibraryEnabled', () => {
  beforeEach(() => __resetNotebookFlagsForTests())
  it('is false until the payload says true', () => {
    expect(styleLibraryEnabled()).toBe(false)
  })
  it('reads the latched payload key', () => {
    latchNotebookFlags({ [STYLE_LIBRARY_FLAG]: true })
    expect(styleLibraryEnabled()).toBe(true)
  })
  it('is false for a non-boolean value', () => {
    latchNotebookFlags({ [STYLE_LIBRARY_FLAG]: 'yes' })
    expect(styleLibraryEnabled()).toBe(false)
  })
})
```
Use the reset and latch export names V1 found in `notebookFlags.js`. If the reset helper has another name, use that name; do not add one.

- [ ] **Step 2: Run it and see it fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a/app && npx vitest run src/pages/journal-2-0/lib/styleLibraryFlag.test.js > /tmp/p3a-t2.log 2>&1; code=$?; tail -5 /tmp/p3a-t2.log; exit $code
```
Expected: FAIL, the module is not found.

- [ ] **Step 3: Implement**

`J/lib/styleLibraryFlag.js`:
```js
/**
 * P3a: the community style library's switch, read from the latched auth payload.
 * It gates CREATING (share, adopt, helpful, follow), never rendering: a style already
 * adopted is an ordinary style row and renders whatever this says.
 */
import { notebookFlag } from './offline/notebookFlags'

export const STYLE_LIBRARY_FLAG = 'notebook_style_library_enabled'
export const styleLibraryEnabled = () => notebookFlag(STYLE_LIBRARY_FLAG) === true
```
In `api/routers/auth.py` `NOTEBOOK_FLAGS`, add `"NOTEBOOK_STYLE_LIBRARY_ENABLED": False,` after the earnings follow-up row. Its comment should say "enablement, unset means OFF".

In `notebookFlags.js` `FLAG_FALLBACKS`, add `notebook_style_library_enabled: false,`.

Add the key to `NOTEBOOK_KEYS` in `tests/test_notebook_flags.py`, add the gate-map row to `tests/test_notebook_flag_parse.py`, and add it to `FLAGS` in `tools/notebook_contract_fixtures.py`. Follow exactly the files and shapes `git show --stat` of V1's commit lists. If that commit touched a file not named here, touch it too and say so in the report.

Add a `docs/feature_flags.json` entry with the shape of `NOTEBOOK_JOURNAL_STYLES_ENABLED` (`:1860`):
```json
"NOTEBOOK_STYLE_LIBRARY_ENABLED": {
  "member_facing": { "label": "Community style library", "where": "Notebook" },
  "status": "dark",
  "where": ["web"],
  "note": "P3a. Gates sharing journal styles to the community gallery, adopting them, Helpful, author pages, follow and the feed. Off: the gallery lists outline items only and every style route answers 404. Payload key notebook_style_library_enabled. Adopt also needs NOTEBOOK_JOURNAL_STYLES_ENABLED. Arm: railway variables --service web --set NOTEBOOK_STYLE_LIBRARY_ENABLED=1 (the owner's). Rollback: set it to 0; adopted styles stay as ordinary styles."
}
```

- [ ] **Step 4: Run the client test and the flag rails**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a/app && npx vitest run src/pages/journal-2-0/lib/styleLibraryFlag.test.js src/pages/journal-2-0/lib/offline/notebookFlags.serverDefaults.test.js > /tmp/p3a-t2.log 2>&1; code=$?; tail -5 /tmp/p3a-t2.log; exit $code
```
```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a && python -m pytest tests/test_notebook_flags.py tests/test_notebook_flag_parse.py tests/test_feature_flag_ledger.py tests/test_visibility_flag_ledger.py -q > /tmp/p3a-t2py.log 2>&1; code=$?; tail -3 /tmp/p3a-t2py.log; exit $code
```
Expected: all PASS. If `test_notebook_flag_parse.py` rail (c) needs a `flag_on("NOTEBOOK_STYLE_LIBRARY_ENABLED"` literal in source, it is added in Task 3. In that case, record the one red here and say so in the report.

- [ ] **Step 5: Commit and push**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a && git add api/routers/auth.py app/src/pages/journal-2-0/lib/offline/notebookFlags.js app/src/pages/journal-2-0/lib/styleLibraryFlag.js app/src/pages/journal-2-0/lib/styleLibraryFlag.test.js tests/test_notebook_flags.py tests/test_notebook_flag_parse.py docs/feature_flags.json tools/notebook_contract_fixtures.py && python tools/check_repo_hygiene.py --staged
```
```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a && git commit -F - -- api/routers/auth.py app/src/pages/journal-2-0/lib/offline/notebookFlags.js app/src/pages/journal-2-0/lib/styleLibraryFlag.js app/src/pages/journal-2-0/lib/styleLibraryFlag.test.js tests/test_notebook_flags.py tests/test_notebook_flag_parse.py docs/feature_flags.json tools/notebook_contract_fixtures.py <<'MSG'
feat(notebook): NOTEBOOK_STYLE_LIBRARY_ENABLED switch, dark (P3a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RcrmLhik6b62vYrvrYWxxs
MSG
git push
```

---

### Task 3: Item types, trading style, sorts, and the gate on the list

**Files:**
- Modify: `S/template_gallery.py`, `tests/test_notebook_template_gallery.py` (the ONE-FACT rail at `:655-664`)
- Create: `J/lib/styleLibrary.js` (lists only in this task), `tests/test_style_library.py`

**Interfaces:**
- Produces, in `template_gallery.py`:
  - `LIBRARY_FLAG = "NOTEBOOK_STYLE_LIBRARY_ENABLED"`, `library_enabled() -> bool`
  - `ITEM_TYPES = ("outline", "style")`
  - `TRADING_STYLES = ("swing", "day", "prop", "options", "earnings", "long_term")`
  - `SORTS = ("newest", "most_used", "trending")`, `TRENDING_DAYS = 7`
  - `list_gallery(viewer_id, *, q, category, sort, section, item_type=None, trading_style=None, is_admin, conn)`
  - summary keys added: `itemType`, `version`, `tradingStyle`, `helpfulCount` (0 until Task 6), `hasRevision` (mine/admin only)
- Produces, in `J/lib/styleLibrary.js`:
  - `export const ITEM_TYPES = Object.freeze([{key:'outline', label:'Outlines'}, {key:'style', label:'Styles'}])`
  - `export const TRADING_STYLES = Object.freeze([...])` with keys equal to the server tuple
  - `export const LIBRARY_SORTS = Object.freeze([{key:'newest',label:'Newest'},{key:'most_used',label:'Most adopted'},{key:'trending',label:'Trending this week'}])`

- [ ] **Step 1: Write the failing tests**

`tests/test_style_library.py`:
```python
"""P3a: item types, trading style, sorts and the library switch on the gallery list."""
from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

import pytest

from api.services.journal_two import template_gallery as gallery

ROOT = Path(__file__).resolve().parents[1]
STYLE_LIB = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "styleLibrary.js"


@pytest.fixture
def conn(tmp_path, monkeypatch):
    # The gallery tests' own connection fixture is the model: copy its shape from
    # tests/test_notebook_template_gallery.py (an auth.db under tmp_path with the users
    # table and db.ensure_schema applied). Name it here; do not import a private fixture.
    from tests.test_notebook_template_gallery import _make_db  # V-step: use the real helper name
    return _make_db(tmp_path)


def _row(conn, *, item_type="outline", status="approved", trading_style=None, user_id="u1",
         listed_at="2026-10-10T00:00:00+00:00", title="T"):
    gid = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO j2_template_gallery (id, user_id, kind, title, description, category, body_json,"
        " status, listed_at, created_at, updated_at, preview_json, item_type, trading_style)"
        " VALUES (?, ?, 'member', ?, '', 'trade_plan', '{}', ?, ?, ?, ?, '[]', ?, ?)",
        (gid, user_id, title, status, listed_at, listed_at, listed_at, item_type, trading_style))
    conn.commit()
    return gid


def test_existing_rows_read_as_outlines(conn):
    gid = _row(conn)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(j2_template_gallery)")}
    assert {"item_type", "payload_json", "version", "trading_style", "source_style_id",
            "pending_json", "pending_at"} <= cols
    assert conn.execute("SELECT item_type, version FROM j2_template_gallery WHERE id = ?",
                        (gid,)).fetchone() == ("outline", 1)


def test_library_off_hides_every_style_row_and_route(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    _row(conn, item_type="outline", title="O")
    _row(conn, item_type="style", title="S")
    titles = [t["title"] for t in gallery.list_gallery("v", conn=conn)]
    assert titles == ["O"]
    with pytest.raises(gallery.GalleryError):
        gallery.list_gallery("v", item_type="style", conn=conn)


def test_library_on_lists_both_and_filters_by_type_and_trading_style(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    _row(conn, item_type="outline", title="O")
    _row(conn, item_type="style", title="S", trading_style="swing")
    _row(conn, item_type="style", title="D", trading_style="day")
    assert {t["title"] for t in gallery.list_gallery("v", conn=conn)} == {"O", "S", "D"}
    assert [t["title"] for t in gallery.list_gallery("v", item_type="style", trading_style="swing",
                                                     conn=conn)] == ["S"]
    with pytest.raises(gallery.GalleryError):
        gallery.list_gallery("v", trading_style="scalping", conn=conn)


def test_trending_counts_distinct_adoptions_in_the_last_seven_days(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    old = _row(conn, item_type="style", title="Old")
    new = _row(conn, item_type="style", title="New")
    conn.executemany("INSERT INTO j2_template_gallery_uses (gallery_id, user_id, used_at) VALUES (?, ?, ?)",
                     [(old, f"m{i}", "2026-09-01T00:00:00+00:00") for i in range(5)]
                     + [(new, "m9", gallery._now())])
    conn.commit()
    rows = gallery.list_gallery("v", sort="trending", conn=conn)
    assert [r["title"] for r in rows][:2] == ["New", "Old"]
    assert rows[0]["trendingCount"] == 1 and rows[1]["trendingCount"] == 0


def test_summary_carries_type_version_and_trading_style(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    _row(conn, item_type="style", trading_style="earnings")
    s = gallery.list_gallery("v", conn=conn)[0]
    assert (s["itemType"], s["version"], s["tradingStyle"]) == ("style", 1, "earnings")
    assert "hasRevision" not in s           # a browsing member never sees review state


def _client_keys(name: str) -> tuple[str, ...]:
    text = STYLE_LIB.read_text(encoding="utf-8")
    m = re.search(rf"export const {name} = Object\.freeze\(\[(.*?)\]\)", text, re.S)
    assert m, f"{name} not found in styleLibrary.js"
    return tuple(re.findall(r"key:\s*'([a-z_]+)'", m.group(1)))


def test_the_client_lists_are_the_server_lists():
    assert _client_keys("ITEM_TYPES") == gallery.ITEM_TYPES
    assert _client_keys("TRADING_STYLES") == gallery.TRADING_STYLES
    assert _client_keys("LIBRARY_SORTS") == gallery.SORTS
    assert len(gallery.TRADING_STYLES) >= 2          # non-vacuity
```
The `conn` fixture must use the real helper in `tests/test_notebook_template_gallery.py`. If that helper is a fixture rather than a function, copy its body into this file instead of importing it. Do not make a private fixture public.

- [ ] **Step 2: Run it and see it fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a && python -m pytest tests/test_style_library.py -q > /tmp/p3a-t3.log 2>&1; code=$?; tail -5 /tmp/p3a-t3.log; exit $code
```
Expected: FAIL, because the columns and constants do not exist.

- [ ] **Step 3: Implement in `template_gallery.py`**

Add the constants beside the existing ones:
```python
LIBRARY_FLAG = "NOTEBOOK_STYLE_LIBRARY_ENABLED"
#: ⛔ ONE FACT IN TWO FILES with ITEM_TYPES / TRADING_STYLES / LIBRARY_SORTS in
#: app/src/pages/journal-2-0/lib/styleLibrary.js; tests/test_style_library.py PARSES that file.
ITEM_TYPES = ("outline", "style")
TRADING_STYLES = ("swing", "day", "prop", "options", "earnings", "long_term")
SORTS = ("newest", "most_used", "trending")
TRENDING_DAYS = 7


def library_enabled() -> bool:
    """P3a's gate, read PER CALL through the one Notebook flag parse (default OFF)."""
    return flag_on(LIBRARY_FLAG, False)
```
In `ensure_gallery_schema`, replace the single `preview_json` ALTER with a loop that keeps it:
```python
    columns = {r[1] for r in conn.execute("PRAGMA table_info(j2_template_gallery)")}
    for name, ddl in (
        ("preview_json", "TEXT"),
        ("item_type", "TEXT NOT NULL DEFAULT 'outline'"),
        ("payload_json", "TEXT"),
        ("version", "INTEGER NOT NULL DEFAULT 1"),
        ("trading_style", "TEXT"),
        ("source_style_id", "TEXT"),
        ("pending_json", "TEXT"),
        ("pending_at", "TEXT"),
    ):
        if name not in columns:
            conn.execute(f"ALTER TABLE j2_template_gallery ADD COLUMN {name} {ddl}")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_template_gallery_style_source"
                 " ON j2_template_gallery(user_id, source_style_id)"
                 " WHERE user_id IS NOT NULL AND source_style_id IS NOT NULL")
```
Add the new columns to `_SELECT_LIST`'s explicit list: `g.item_type, g.version, g.trading_style, g.pending_at`. Never `payload_json` and never `pending_json`. Extend the assert:
```python
assert ("g.*" not in _SELECT_LIST and "body_json" not in _SELECT_LIST
        and "payload_json" not in _SELECT_LIST and "pending_json" not in _SELECT_LIST)
```
Add a trending count to `_SELECT` beside `used_by` (it is a string, so build the interval with a parameter-free literal):
```python
    " (SELECT COUNT(*) FROM j2_template_gallery_uses x WHERE x.gallery_id = g.id"
    f"    AND x.used_at >= strftime('%Y-%m-%dT%H:%M:%S', 'now', '-{TRENDING_DAYS} days')) AS trending_count,"
```
`used_at` is written by `_now()` as ISO with `+00:00`. A string comparison against `strftime('%Y-%m-%dT%H:%M:%S', ...)` orders correctly for the same UTC prefix. Task 1 V2 confirms the stored shape; if it differs, compare with `datetime(x.used_at)` instead and say so.

In `list_gallery`, add the two parameters and the gate:
```python
    if item_type not in (None, "", *ITEM_TYPES):
        raise GalleryError("Unknown item type.")
    if trading_style not in (None, "", *TRADING_STYLES):
        raise GalleryError("Unknown trading style.")
    if not library_enabled():
        if item_type == "style" or trading_style:
            raise GalleryError("Unknown item type.")
        where.append("g.item_type = 'outline'")
    elif item_type:
        where.append("g.item_type = ?")
        args.append(item_type)
    if trading_style:
        where.append("g.trading_style = ?")
        args.append(trading_style)
```
Order: `trending` sorts by `trending_count DESC, used_by DESC, COALESCE(g.listed_at, g.created_at) DESC`.

`_summary` adds:
```python
        "itemType": row["item_type"] if "item_type" in keys else "outline",
        "version": int(row["version"] or 1) if "version" in keys else 1,
        "tradingStyle": row["trading_style"] if "trading_style" in keys else None,
        "trendingCount": int(row["trending_count"] or 0) if "trending_count" in keys else 0,
        "helpfulCount": 0,
```
Inside the `if mine or is_admin:` block, add `out["hasRevision"] = bool(row["pending_at"]) if "pending_at" in keys else False`.

`J/lib/styleLibrary.js` (lists only now; Task 9 adds the calls):
```js
/**
 * P3a: the community STYLE library's client lists. LAZY-ONLY: import this file only from
 * the lazy TemplateGallery chunk or the lazy styles chunk, never from an eager Notebook
 * file (the first-open byte budget, R-P3-5).
 *
 * ⛔ ITEM_TYPES, TRADING_STYLES and LIBRARY_SORTS are ONE FACT IN TWO FILES with
 * api/services/journal_two/template_gallery.py; tests/test_style_library.py PARSES this
 * file and holds the keys equal, in order.
 */
export const ITEM_TYPES = Object.freeze([
  { key: 'outline', label: 'Outlines' },
  { key: 'style', label: 'Styles' },
])

export const TRADING_STYLES = Object.freeze([
  { key: 'swing', label: 'Swing' },
  { key: 'day', label: 'Day' },
  { key: 'prop', label: 'Prop' },
  { key: 'options', label: 'Options' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'long_term', label: 'Long-term' },
])

export const LIBRARY_SORTS = Object.freeze([
  { key: 'newest', label: 'Newest' },
  { key: 'most_used', label: 'Most adopted' },
  { key: 'trending', label: 'Trending this week' },
])

export function tradingStyleLabel(key) {
  return TRADING_STYLES.find((t) => t.key === key)?.label || null
}
```
In `tests/test_notebook_template_gallery.py`, find a test pinning `SORTS` against the client `GALLERY_SORTS`. If one exists, it now differs: `GALLERY_SORTS` keeps `newest`/`most_used` for the outline-only view. Change that assertion to `_client_tuple("GALLERY_SORTS") == svc.SORTS[:2]` and add a comment saying why. Do not add `trending` to the eager `templateGallery.js`.

- [ ] **Step 4: Run the tests**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a && python -m pytest tests/test_style_library.py tests/test_notebook_template_gallery.py tests/test_notebook_flag_parse.py -q > /tmp/p3a-t3.log 2>&1; code=$?; tail -3 /tmp/p3a-t3.log; exit $code
```
Expected: all PASS. Before reporting, prove two of the new rails can fail, then restore each file by capture and verify it against `git cat-file blob HEAD:<path>`:
1. Remove the `g.item_type = 'outline'` clause; the library-off test fails.
2. Add a seventh key to the client `TRADING_STYLES`; the client-lists test fails.

- [ ] **Step 5: Commit and push**

Use the commit procedure in Global Constraints, with the paths `api/services/journal_two/template_gallery.py app/src/pages/journal-2-0/lib/styleLibrary.js tests/test_style_library.py tests/test_notebook_template_gallery.py`. Message: `feat(notebook): gallery item types, trading style, trending sort, library gate on the list (P3a)`.

---

### Task 4: Publishing a style, and held revisions

**Files:**
- Modify: `S/template_gallery.py`, `api/routers/notebook_template_gallery.py`, `tests/test_style_library.py`

**Interfaces:**
- Consumes: Task 3's columns and `library_enabled()`. Also `journal_styles.get_style(user_id, style_id, conn, full=True)`, `journal_styles.BUILTIN_STYLES`, `note_kinds.BUILTIN_NOTE_KINDS`, `note_properties.BUILTIN_USER_SET_IDS` / `is_builtin_property_id`.
- Produces:
  - `CUSTOM_KIND_SENTENCE = "Only styles for a built-in kind of note can be shared yet."`
  - `style_payload(user_id, style_id, conn) -> dict | None`, returning `{kindId, outlineBodyJson, blocks, properties, droppedProperties}`. `droppedProperties` is a count and never stored.
  - `publish_style(user_id, style_id, *, title, description, category, trading_style, conn=None) -> dict | None`
  - In `admin_act`, `approve` on an item with `pending_at` swaps the revision in and bumps `version`. `reject` on such an item clears the revision and keeps the listing.
  - Route `POST /api/j2/template-gallery/styles`, body `{styleId, title, description?, category, tradingStyle?}`. It returns `{template, droppedProperties}`, or 404 when the library is off or the style is not the member's. It is rate-limited with the existing publish scopes.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_style_library.py`)

```python
from api.services.journal_two import journal_styles as js


def _style(conn, user_id="author", **over):
    payload = {"name": "Weekend Prep", "kindId": "weekend_prep", "blocks": [],
               "outlineBodyJson": {"type": "doc", "content": [
                   {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Plan"}]},
                   {"type": "paragraph", "content": [{"type": "text", "text": "mail me at a@b.com"}]},
                   {"type": "image", "attrs": {"src": "/api/j2/notes/n1/att/x.png"}},
                   {"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": True},
                       "content": [{"type": "paragraph", "content": [{"type": "text", "text": "done"}]}]}]},
               ]}}
    payload.update(over)
    return js.create_style(user_id, payload, conn)


@pytest.fixture
def lib_on(monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")


def test_a_published_style_payload_goes_through_the_gallery_reducer(conn, lib_on):
    s = _style(conn)
    item = gallery.publish_style("author", s["id"], title="Weekend Prep", description="",
                                 category="journal", trading_style="swing", conn=conn)
    raw = conn.execute("SELECT payload_json, status, item_type FROM j2_template_gallery WHERE id = ?",
                       (item["id"],)).fetchone()
    payload = json.loads(raw["payload_json"])
    text = json.dumps(payload)
    assert raw["status"] == "pending" and raw["item_type"] == "style"
    assert "a@b.com" not in text and '"image"' not in text and "/api/j2/notes/" not in text
    assert '"checked": true' not in text
    assert payload["kindId"] == "weekend_prep"


def test_a_style_on_a_custom_kind_is_refused(conn, lib_on):
    from api.services.journal_two import note_kinds as nk
    kind = nk.create_kind("author", {"name": "My scalps"}, conn)          # V7: the real creator
    s = _style(conn, kindId=kind["id"])
    with pytest.raises(gallery.GalleryError) as e:
        gallery.publish_style("author", s["id"], title="X", description="", category="journal",
                              trading_style=None, conn=conn)
    assert str(e.value) == gallery.CUSTOM_KIND_SENTENCE


def test_member_property_defaults_never_travel(conn, lib_on):
    from api.services.journal_two import note_properties as np
    mine = np.create_property_def("author", "Conviction", "text", None, conn=conn)
    builtin = next(iter(sorted(np.BUILTIN_USER_SET_IDS - {"builtin:note_kind"})))
    s = _style(conn, properties={mine["id"]: "high"})
    out = gallery.style_payload("author", s["id"], conn)
    assert mine["id"] not in out["properties"] and out["droppedProperties"] == 1
    assert builtin not in out["properties"]              # nothing invented


def test_another_members_style_is_not_found(conn, lib_on):
    s = _style(conn)
    assert gallery.publish_style("intruder", s["id"], title="X", description="", category="journal",
                                 trading_style=None, conn=conn) is None


def test_an_approved_style_update_is_held_not_listed(conn, lib_on):
    s = _style(conn)
    item = gallery.publish_style("author", s["id"], title="V1", description="", category="journal",
                                 trading_style=None, conn=conn)
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    js.update_style("author", s["id"], {"name": "Weekend Prep 2"}, conn)
    again = gallery.publish_style("author", s["id"], title="V2", description="", category="journal",
                                  trading_style=None, conn=conn)
    assert again["id"] == item["id"]
    listed = gallery.get_item("viewer", item["id"], conn=conn)
    assert listed["title"] == "V1" and listed["version"] == 1           # still the approved version
    queue = gallery.admin_queue(conn=conn)
    rev = next(r for r in queue["pending"] if r["id"] == item["id"])
    assert rev["hasRevision"] is True
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=rev["updatedAt"], conn=conn)
    after = gallery.get_item("viewer", item["id"], conn=conn)
    assert after["title"] == "V2" and after["version"] == 2


def test_rejecting_a_revision_keeps_the_listed_version(conn, lib_on):
    s = _style(conn)
    item = gallery.publish_style("author", s["id"], title="V1", description="", category="journal",
                                 trading_style=None, conn=conn)
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    gallery.publish_style("author", s["id"], title="V2", description="", category="journal",
                          trading_style=None, conn=conn)
    rev = next(r for r in gallery.admin_queue(conn=conn)["pending"] if r["id"] == item["id"])
    gallery.admin_act("admin", item["id"], "reject", note="Too thin", conn=conn)
    listed = gallery.get_item("viewer", item["id"], conn=conn)
    assert listed["title"] == "V1" and listed["version"] == 1
    mine = gallery.get_item("author", item["id"], conn=conn)
    assert mine["reviewNote"] == "Too thin" and mine["hasRevision"] is False


def test_publish_style_is_404_with_the_library_off(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    s = _style(conn)
    assert gallery.publish_style("author", s["id"], title="X", description="", category="journal",
                                 trading_style=None, conn=conn) is None
```
Use the real creator names V7 and V8 found (`note_kinds.create_kind`, `note_properties.create_property_def`). If a name differs, use the real name and record it in the report.

- [ ] **Step 2: Run them and see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a && python -m pytest tests/test_style_library.py -q > /tmp/p3a-t4.log 2>&1; code=$?; tail -5 /tmp/p3a-t4.log; exit $code
```
Expected: FAIL, because `publish_style` does not exist.

- [ ] **Step 3: Implement in `template_gallery.py`**

```python
CUSTOM_KIND_SENTENCE = "Only styles for a built-in kind of note can be shared yet."


def style_payload(user_id: str, style_id: Any, conn: sqlite3.Connection) -> dict | None:
    """The portable copy of one of the member's own styles, or None when it is not theirs.

    ⛔ A built-in kind only (R-P3-9). The outline is inlined (from the style, else its
    template) and reduced in gallery mode. Blocks travel verbatim: their settings are enum
    values the server's own catalogue validated on save. Only BUILT-IN user-set property
    defaults travel; the member's own are counted in `droppedProperties` and left out."""
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two import note_kinds as nk
    from api.services.journal_two import note_properties as np

    if not isinstance(style_id, str) or style_id.startswith(js.BUILTIN_PREFIX):
        return None
    style = js.get_style(user_id, style_id, conn, full=True)
    if style is None:
        return None
    if style["kindId"] not in {k["id"] for k in nk.BUILTIN_NOTE_KINDS}:
        raise GalleryError(CUSTOM_KIND_SENTENCE)
    outline = style.get("outlineBodyJson")
    if not outline and style.get("outlineTemplateId"):
        row = conn.execute("SELECT body_json FROM j2_note_templates WHERE id = ? AND user_id = ?",
                           (style["outlineTemplateId"], user_id)).fetchone()
        try:
            outline = json.loads(row["body_json"]) if row else None
        except (TypeError, ValueError):
            outline = None
    props, dropped = {}, 0
    for pid, value in (style.get("properties") or {}).items():
        if np.is_builtin_property_id(pid) and pid in np.BUILTIN_USER_SET_IDS:
            props[pid] = value
        else:
            dropped += 1
    return {
        "kindId": style["kindId"],
        "outlineBodyJson": sanitize_body(outline, user_id) if outline else None,
        "blocks": style.get("blocks") or [],
        "properties": props,
        "droppedProperties": dropped,
    }


def _clean_trading_style(raw: Any) -> str | None:
    if raw in (None, ""):
        return None
    if raw not in TRADING_STYLES:
        raise GalleryError("Pick a trading style, or leave it blank.")
    return raw


def publish_style(user_id: str, style_id: Any, *, title: Any, description: Any, category: Any,
                  trading_style: Any, conn: sqlite3.Connection | None = None) -> dict | None:
    """Submit (or resubmit) one of the member's own styles. None when the library is off
    or the style is not theirs.

    First publish: a PENDING style item. Again while pending or rejected: replaces it in
    place, back to pending (today's outline rule). Again while APPROVED: the new version is
    HELD in `pending_json` and the approved one stays listed (R-P3-3)."""
    if not library_enabled():
        return None
    clean_title = _clean_text(title, field="title", limit=MAX_TITLE_CHARS, required=True)
    clean_desc = _clean_text(description, field="description", limit=MAX_DESCRIPTION_CHARS, required=False)
    clean_cat = _clean_category(category)
    clean_ts = _clean_trading_style(trading_style)
    owned = conn is None
    conn = conn or get_connection()
    try:
        payload = style_payload(user_id, style_id, conn)
        if payload is None:
            return None
        dropped = payload.pop("droppedProperties")
        payload_json = json.dumps(payload)
        if len(payload_json.encode("utf-8")) > MAX_BODY_BYTES:
            raise GalleryError("That style is too long for the gallery. Trim its outline and try again.")
        body = payload["outlineBodyJson"] or {"type": "doc", "content": []}
        preview_json = json.dumps(preview_lines(body))
        now = _now()
        existing = conn.execute(
            "SELECT id, status FROM j2_template_gallery WHERE user_id = ? AND source_style_id = ?",
            (user_id, style_id)).fetchone()
        if existing and existing["status"] == "approved":
            revision = {"title": clean_title, "description": clean_desc, "category": clean_cat,
                        "tradingStyle": clean_ts, "payload": payload, "preview": json.loads(preview_json)}
            conn.execute(
                "UPDATE j2_template_gallery SET pending_json = ?, pending_at = ?, review_note = NULL,"
                " updated_at = ? WHERE id = ?",
                (json.dumps(revision), now, now, existing["id"]))
            gid = existing["id"]
        elif existing:
            conn.execute(
                "UPDATE j2_template_gallery SET title = ?, description = ?, category = ?, trading_style = ?,"
                " body_json = ?, payload_json = ?, status = 'pending', review_note = NULL, reviewed_by = NULL,"
                " reviewed_at = NULL, featured = 0, listed_at = NULL, updated_at = ?, preview_json = ?,"
                " pending_json = NULL, pending_at = NULL WHERE id = ?",
                (clean_title, clean_desc, clean_cat, clean_ts, json.dumps(body), payload_json, now,
                 preview_json, existing["id"]))
            gid = existing["id"]
        else:
            gid = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO j2_template_gallery (id, user_id, source_style_id, kind, title, description,"
                " category, body_json, status, created_at, updated_at, preview_json, item_type,"
                " payload_json, version, trading_style)"
                " VALUES (?, ?, ?, 'member', ?, ?, ?, ?, 'pending', ?, ?, ?, 'style', ?, 1, ?)",
                (gid, user_id, style_id, clean_title, clean_desc, clean_cat, json.dumps(body), now, now,
                 preview_json, payload_json, clean_ts))
        conn.commit()
        out = _summary(_row(conn, gid), viewer_id=user_id, is_admin=False)
        out["droppedProperties"] = dropped
        return out
    finally:
        if owned:
            conn.close()
```
`body_json` holds the reduced outline, so the existing preview, list and stored-body paths need no change.

In `admin_queue`, the pending query becomes `g.status = 'pending' OR g.pending_at IS NOT NULL`.

In `admin_act`, `approve`: before the existing conditional UPDATE, read `row["pending_json"]`. If it is present, apply it in the same conditional statement:
```python
        if action == "approve" and row["pending_json"]:
            rev = json.loads(row["pending_json"])
            cur = conn.execute(
                "UPDATE j2_template_gallery SET title = ?, description = ?, category = ?, trading_style = ?,"
                " payload_json = ?, body_json = ?, preview_json = ?, version = version + 1,"
                " pending_json = NULL, pending_at = NULL, review_note = NULL, reviewed_by = ?,"
                " reviewed_at = ?, updated_at = ? WHERE id = ? AND updated_at = ?",
                (rev["title"], rev["description"], rev["category"], rev.get("tradingStyle"),
                 json.dumps(rev["payload"]),
                 json.dumps(rev["payload"].get("outlineBodyJson") or {"type": "doc", "content": []}),
                 json.dumps(rev["preview"]), admin_id, now, now, gallery_id, reviewed_updated_at))
            if cur.rowcount != 1:
                conn.rollback()
                raise GalleryConflict(APPROVE_STALE_SENTENCE)
```
It needs the same guard as the existing branch (`reviewed_updated_at` required).

`reject` on a row with `pending_json`: clear `pending_json`/`pending_at`, set `review_note`, and leave `status`, `listed_at` and `featured` as they are. A row without a revision keeps today's reject.

`_summary`'s `mine or is_admin` block also exposes the revision's title for the reviewer: `out["revisionTitle"] = json.loads(row["pending_json"])["title"] if row["pending_json"] else None`. Read it only when `"pending_json" in keys`; the list query never selects it, and the queue reads `_SELECT`. Make `admin_queue` use `_SELECT` for the pending rows only: they are a reviewer's view, and the full row is what they review.

Router, `POST /styles`, placed BEFORE `@router.get("/{gallery_id}")` so the literal path wins:
```python
@router.post("/styles")
def publish_style_endpoint(body: dict[str, Any] = Depends(paid_body), user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{styleId, title, description?, category, tradingStyle?}` -> a PENDING style item, or a
    held revision of an approved one. 404 while the library is off (R-P3-10)."""
    if not gallery.library_enabled():
        raise public.not_found()
    public.enforce_rate(PUBLISH_RATE, SCOPE_PUBLISH, f"member:{user['id']}", PUBLISH_RATE_SENTENCE, public=False)
    day = _daily_take(DAILY_PUBLISH_SCOPE, user, "NOTEBOOK_GALLERY_PUBLISH_DAILY_CAP", 10, PUBLISH_RATE_SENTENCE)
    try:
        item = gallery.publish_style(user["id"], body.get("styleId"), title=body.get("title"),
                                     description=body.get("description"), category=body.get("category"),
                                     trading_style=body.get("tradingStyle"))
    except gallery.GalleryError as e:
        _give_back(day, DAILY_PUBLISH_SCOPE, user)
        raise _bad(e)
    if item is None:
        _give_back(day, DAILY_PUBLISH_SCOPE, user)
        raise public.not_found()
    dropped = item.pop("droppedProperties", 0)
    return {"template": item, "droppedProperties": dropped}
```
Update the router docstring's route table with the new line.

Add a router test to `tests/test_style_library.py` that uses the TestClient shape `tests/test_notebook_template_gallery.py` already uses:
- with the library off, `POST /api/j2/template-gallery/styles` → 404;
- with it on, a paid member → 200 and `template.itemType == "style"`.

- [ ] **Step 4: Run the tests**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a && python -m pytest tests/test_style_library.py tests/test_notebook_template_gallery.py -q > /tmp/p3a-t4.log 2>&1; code=$?; tail -3 /tmp/p3a-t4.log; exit $code
```
Expected: all PASS. Then run these mutation proofs, restoring each file afterwards:
1. Make `style_payload` skip `sanitize_body`; the reducer test fails.
2. Make approved re-publish take the in-place branch; the held-revision test fails.

- [ ] **Step 5: Commit and push**

Paths: `api/services/journal_two/template_gallery.py api/routers/notebook_template_gallery.py tests/test_style_library.py`. Message: `feat(notebook): share a journal style to the community gallery; author updates are held until approved (P3a)`.

---

### Task 5: Adopt, notify-me, and the update merge

**Files:**
- Modify: `S/template_gallery.py`, `api/routers/notebook_template_gallery.py`
- Create: `tests/test_style_library_adopt.py`

**Interfaces:**
- Consumes:
  - from Task 4: style items with `payload_json` and `version`;
  - `journal_styles.create_style(user_id, payload, conn)`, `update_style(user_id, style_id, patch, conn)`, `get_style`.
- Produces:
  - New table `j2_gallery_watches(gallery_id TEXT, user_id TEXT, style_id TEXT, notified_version INTEGER NOT NULL DEFAULT 0, created_at TEXT, PRIMARY KEY (gallery_id, user_id))`, created in `_DDL`.
  - `adopt_style(user_id, gallery_id, *, notify: bool, conn=None) -> dict | None`, returning `{"style": style, "notify": bool, "credit": str}`.
  - `list_updates(user_id, conn=None) -> list[dict]`. Each entry is `{galleryId, title, styleId, styleName, fromVersion, toVersion}` for the member's adopted styles whose item is listed at a higher version. It includes styles adopted without notify.
  - `plan_update(user_id, style_id, conn=None) -> dict | None`, returning `{galleryId, fromVersion, toVersion, addBlocks: [ids], addProperties: [ids], outlineChanged: bool, newOutline: doc|None}`.
  - `apply_update(user_id, style_id, *, take_outline: bool, base_updated_at: str, conn=None) -> dict | None`. It returns the updated style, or raises `GalleryConflict` when the style changed since `base_updated_at`.
  - `ADOPT_NEEDS_STYLES_SENTENCE = "Journal styles are not on for you yet, so a style can't be adopted."`
  - Routes:
    - `POST /{gallery_id}/adopt` with body `{notify?: bool}` → `{style, notify, credit}`.
    - `GET /updates` → `{updates: [...]}`.
    - `GET /updates/{style_id}` → `{plan}`.
    - `POST /updates/{style_id}` with body `{takeOutline: bool, baseUpdatedAt}` → `{style}`.
    - The literal `/updates` routes are declared BEFORE `/{gallery_id}`. All of them 404 while the library is off. Adopt is rate-limited per R-P3-11.

- [ ] **Step 1: Write the failing tests**

`tests/test_style_library_adopt.py` uses the same `conn` and `lib_on` fixtures as `test_style_library.py`. Put the shared helpers in a `tests/_style_library_helpers.py` module both files import, not in `conftest.py`. The helpers are the `conn` builder, `_style`, and a `listed_style(conn)` helper that publishes and approves a style by "author".

```python
from api.services.journal_two import journal_styles as js
from api.services.journal_two import template_gallery as gallery
from tests._style_library_helpers import conn, lib_on, listed_style  # noqa: F401  (fixtures)


def test_adopt_makes_the_members_own_copy_with_its_source(conn, lib_on):
    item = listed_style(conn)
    out = gallery.adopt_style("member", item["id"], notify=True, conn=conn)
    s = out["style"]
    assert s["sourceGalleryId"] == item["id"] and s["sourceVersion"] == 1
    assert s["kindId"] == "weekend_prep" and not s["builtin"]
    assert out["credit"] == f"Based on {item['author']}'s {item['title']}"
    row = conn.execute("SELECT notified_version FROM j2_gallery_watches WHERE gallery_id = ? AND user_id = ?",
                       (item["id"], "member")).fetchone()
    assert row["notified_version"] == 1


def test_adopt_counts_once_per_member_and_is_404_when_not_listed(conn, lib_on):
    item = listed_style(conn)
    gallery.adopt_style("member", item["id"], notify=False, conn=conn)
    gallery.adopt_style("member", item["id"], notify=False, conn=conn)
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery_uses WHERE gallery_id = ?",
                        (item["id"],)).fetchone()[0] == 1
    conn.execute("UPDATE j2_template_gallery SET hidden = 1 WHERE id = ?", (item["id"],))
    conn.commit()
    assert gallery.adopt_style("member2", item["id"], notify=False, conn=conn) is None


def test_adopt_needs_the_journal_styles_switch(conn, lib_on, monkeypatch):
    item = listed_style(conn)
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "0")
    with pytest.raises(gallery.GalleryConflict) as e:
        gallery.adopt_style("member", item["id"], notify=False, conn=conn)
    assert str(e.value) == gallery.ADOPT_NEEDS_STYLES_SENTENCE


def test_an_outline_item_cannot_be_adopted_as_a_style(conn, lib_on):
    gid = conn.execute("SELECT id FROM j2_template_gallery WHERE item_type = 'outline' LIMIT 1").fetchone()
    # seed_firm_templates gives every fresh db firm outlines; if V-step shows none, insert one here.
    assert gallery.adopt_style("member", gid["id"], notify=False, conn=conn) is None


def _bump(conn, item, **style_patch):
    js.update_style("author", item["sourceStyleId"], style_patch, conn)
    gallery.publish_style("author", item["sourceStyleId"], title=item["title"], description="",
                          category="journal", trading_style=None, conn=conn)
    rev = next(r for r in gallery.admin_queue(conn=conn)["pending"] if r["id"] == item["id"])
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=rev["updatedAt"], conn=conn)


def test_list_updates_names_styles_behind_their_item(conn, lib_on):
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    assert gallery.list_updates("member", conn=conn) == []
    _bump(conn, item, blocks=[{"block": "myRules", "enabled": True, "settings": {}}])
    ups = gallery.list_updates("member", conn=conn)
    assert [(u["styleId"], u["fromVersion"], u["toVersion"]) for u in ups] == [(mine["id"], 1, 2)]


def test_update_never_removes_or_reverts_member_edits(conn, lib_on):
    item = listed_style(conn, blocks=[{"block": "preEntryChecklist", "enabled": True,
                                       "settings": {"requireAll": False}}])
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    # the member removes the checklist, rewrites the outline
    edited = js.update_style("member", mine["id"], {
        "blocks": [], "outlineBodyJson": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "my own words"}]}]}}, conn)
    _bump(conn, item, blocks=[{"block": "preEntryChecklist", "enabled": True, "settings": {"requireAll": True}},
                              {"block": "myRules", "enabled": True, "settings": {}}])
    plan = gallery.plan_update("member", mine["id"], conn=conn)
    assert plan["addBlocks"] == ["myRules"]                 # the removed checklist is NOT re-added
    out = gallery.apply_update("member", mine["id"], take_outline=False,
                               base_updated_at=edited["updatedAt"], conn=conn)
    assert [b["block"] for b in out["blocks"]] == ["myRules"]
    assert "my own words" in json.dumps(out["outlineBodyJson"])
    assert out["sourceVersion"] == 2


def test_update_takes_the_new_outline_only_when_asked(conn, lib_on):
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    _bump(conn, item, outlineBodyJson={"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "New plan"}]}]})
    out = gallery.apply_update("member", mine["id"], take_outline=True,
                               base_updated_at=mine["updatedAt"], conn=conn)
    assert "New plan" in json.dumps(out["outlineBodyJson"])


def test_a_stale_update_is_refused(conn, lib_on):
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    _bump(conn, item, blocks=[{"block": "myRules", "enabled": True, "settings": {}}])
    js.update_style("member", mine["id"], {"name": "Renamed"}, conn)
    with pytest.raises(gallery.GalleryConflict):
        gallery.apply_update("member", mine["id"], take_outline=False,
                             base_updated_at=mine["updatedAt"], conn=conn)
```
`listed_style(conn, **style_overrides)` returns the approved summary plus `sourceStyleId`. Add `sourceStyleId` to `_summary`'s `mine or is_admin` block, so the helper reads it as the author.

- [ ] **Step 2: Run and see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a && python -m pytest tests/test_style_library_adopt.py -q > /tmp/p3a-t5.log 2>&1; code=$?; tail -5 /tmp/p3a-t5.log; exit $code
```

- [ ] **Step 3: Implement**

`_DDL` gains:
```python
    """CREATE TABLE IF NOT EXISTS j2_gallery_watches (
        gallery_id        TEXT NOT NULL,
        user_id           TEXT NOT NULL,
        style_id          TEXT NOT NULL,
        notified_version  INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL,
        PRIMARY KEY (gallery_id, user_id)
    )""",
```
Then the functions:
```python
ADOPT_NEEDS_STYLES_SENTENCE = "Journal styles are not on for you yet, so a style can't be adopted."
UPDATE_STALE_SENTENCE = "This style changed since you opened the update. Nothing was changed. Look again."


def _listed_style_row(conn, gallery_id):
    row = _row(conn, gallery_id)
    if row is None or row["item_type"] != "style" or row["status"] != "approved" or row["hidden"]:
        return None
    return row


def adopt_style(user_id: str, gallery_id: str, *, notify: bool = False,
                conn: sqlite3.Connection | None = None) -> dict | None:
    """The member's own copy of a listed style (R-P3-10): a new j2_journal_styles row through
    journal_styles.create_style, with source_gallery_id/source_version written. None when the
    library is off or the item is not a listed style. A repeat adopt makes another copy (the
    member's choice) and never counts twice."""
    from api.services.journal_two import journal_styles as js
    if not library_enabled():
        return None
    if not js.enabled():
        raise GalleryConflict(ADOPT_NEEDS_STYLES_SENTENCE)
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _listed_style_row(conn, gallery_id)
        if row is None:
            return None
        payload = json.loads(row["payload_json"] or "{}")
        try:
            style = js.create_style(user_id, {
                "name": (row["title"] or "Community style")[: js.MAX_STYLE_NAME_CHARS],
                "kindId": payload.get("kindId"), "blocks": payload.get("blocks") or [],
                "outlineBodyJson": payload.get("outlineBodyJson"),
                "properties": payload.get("properties") or {}}, conn)
        except js.StyleValidationError as e:
            raise GalleryError(str(e)) from e
        now = _now()
        conn.execute("UPDATE j2_journal_styles SET source_gallery_id = ?, source_version = ? WHERE id = ?",
                     (gallery_id, int(row["version"] or 1), style["id"]))
        if row["user_id"] != user_id:
            conn.execute("INSERT OR IGNORE INTO j2_template_gallery_uses (gallery_id, user_id, used_at)"
                         " VALUES (?, ?, ?)", (gallery_id, user_id, now))
        if notify:
            conn.execute(
                "INSERT INTO j2_gallery_watches (gallery_id, user_id, style_id, notified_version, created_at)"
                " VALUES (?, ?, ?, ?, ?) ON CONFLICT(gallery_id, user_id) DO UPDATE SET"
                " style_id = excluded.style_id, notified_version = excluded.notified_version",
                (gallery_id, user_id, style["id"], int(row["version"] or 1), now))
        conn.commit()
        return {"style": js.get_style(user_id, style["id"], conn),
                "notify": bool(notify),
                "credit": f"Based on {_author_label(row)}'s {row['title']}"}
    finally:
        if owned:
            conn.close()
```
Check that `js.enabled()` and `js.StyleValidationError` are the real names in `journal_styles.py` (V6). Also check that `create_style` commits. If it commits, the follow-up UPDATE needs its own `conn.commit()`, which the code above has.

`list_updates`:
```python
def list_updates(user_id: str, conn: sqlite3.Connection | None = None) -> list[dict]:
    if not library_enabled():
        return []
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT s.id AS style_id, s.name AS style_name, s.source_version, g.id AS gallery_id,"
            " g.title, g.version FROM j2_journal_styles s JOIN j2_template_gallery g"
            " ON g.id = s.source_gallery_id WHERE s.user_id = ? AND s.deleted_at IS NULL"
            " AND g.item_type = 'style' AND g.status = 'approved' AND g.hidden = 0"
            " AND g.version > COALESCE(s.source_version, 0) ORDER BY g.updated_at DESC",
            (user_id,)).fetchall()
        return [{"galleryId": r["gallery_id"], "title": r["title"], "styleId": r["style_id"],
                 "styleName": r["style_name"], "fromVersion": int(r["source_version"] or 0),
                 "toVersion": int(r["version"])} for r in rows]
    finally:
        if owned:
            conn.close()
```
`plan_update` and `apply_update`. ⛔ "A removed block is never re-added" needs the block ids of the version the member ADOPTED: without them, a block they removed looks exactly like one they never had. `j2_gallery_watches` cannot carry it, because a member can adopt without notify. So add a column `source_block_ids TEXT` to `j2_journal_styles` (an additive ALTER in `journal_two/db.py` beside `source_gallery_id`, `db.py:2047-2048`). `adopt_style` writes it next to `source_gallery_id`, and every applied update rewrites it, as the JSON list of the item's block ids at that version.
```python
def _plan(conn, user_id, style_id):
    """(mine, row, plan); plan is None when there is nothing newer to offer."""
    from api.services.journal_two import journal_styles as js
    mine = js.get_style(user_id, style_id, conn, full=True)
    if mine is None or not mine.get("sourceGalleryId"):
        return None, None, None
    row = _listed_style_row(conn, mine["sourceGalleryId"])
    if row is None or int(row["version"]) <= int(mine.get("sourceVersion") or 0):
        return mine, row, None
    theirs = json.loads(row["payload_json"] or "{}")
    have = {b["block"] for b in mine.get("blocks") or []}
    src = conn.execute("SELECT source_block_ids FROM j2_journal_styles WHERE id = ? AND user_id = ?",
                       (style_id, user_id)).fetchone()
    adopted = set(json.loads((src and src["source_block_ids"]) or "[]"))
    add_blocks = [b["block"] for b in theirs.get("blocks") or []
                  if b["block"] not in have and b["block"] not in adopted]
    add_props = [p for p in (theirs.get("properties") or {}) if p not in (mine.get("properties") or {})]
    outline_changed = (json.dumps(theirs.get("outlineBodyJson"), sort_keys=True)
                       != json.dumps(mine.get("outlineBodyJson"), sort_keys=True))
    plan = {"galleryId": row["id"], "fromVersion": int(mine.get("sourceVersion") or 0),
            "toVersion": int(row["version"]), "addBlocks": add_blocks, "addProperties": add_props,
            "outlineChanged": outline_changed,
            "newOutline": theirs.get("outlineBodyJson") if outline_changed else None}
    return mine, row, plan
```
`plan_update(user_id, style_id)` returns `_plan(...)[2]` (None ⇒ the route answers 404).

`apply_update` loads the row and compares `updated_at` to `base_updated_at`; if they differ, it raises `GalleryConflict(UPDATE_STALE_SENTENCE)`. It then builds the patch:
- `blocks = mine.blocks + [theirs' block entries for add_blocks]`, appended in the author's order;
- `properties = {**mine.properties, **{p: theirs[p] for p in add_props}}`;
- `outlineBodyJson` replaced only if `take_outline`.

It calls `js.update_style` with that patch, then sets `source_version` and `source_block_ids` in one UPDATE, commits, and returns `get_style`.

Because `source_block_ids` lives on `j2_journal_styles`, add a test in `test_style_library_adopt.py` that the column exists, and add the ALTER beside `db.py:2047-2048` in the same shape. Task 1 V6 notes how those columns were added. Update the plan doc's File map row for Task 5 in the report: it also modifies `S/db.py`.

Routes, each starting with `if not gallery.library_enabled(): raise public.not_found()`:
```python
@router.get("/updates")
def list_updates_endpoint(user: dict = Depends(require_paid)) -> dict[str, Any]: ...

@router.get("/updates/{style_id}")
def plan_update_endpoint(style_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    # 404 when no plan (not mine, not adopted, or nothing newer)

@router.post("/updates/{style_id}")
def apply_update_endpoint(style_id: str, body: dict[str, Any] = Depends(paid_body),
                          user: dict = Depends(require_paid)) -> dict[str, Any]:
    # {takeOutline: bool, baseUpdatedAt: str}; GalleryConflict -> 409 via _bad

@router.post("/{gallery_id}/adopt")
def adopt_endpoint(gallery_id: str, body: dict[str, Any] = Depends(paid_body),
                   user: dict = Depends(require_paid)) -> dict[str, Any]:
    # enforce_rate("30/hour", "notebook-gallery-adopt", ...) + _daily_take("notebook_gallery_adopt", ...,
    # "NOTEBOOK_GALLERY_ADOPT_DAILY_CAP", 50, ADOPT_RATE_SENTENCE); give back on None or error
```
The router adds `ADOPT_RATE = "30/hour"`, `SCOPE_ADOPT = "notebook-gallery-adopt"`, `DAILY_ADOPT_SCOPE = "notebook_gallery_adopt"` and `ADOPT_RATE_SENTENCE = "You've adopted a lot of styles today. Try again later."`. Add the new in-process scope to CLAUDE.md's single-process list in Task 12's docs commit, not here.

- [ ] **Step 4: Run the tests**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a && python -m pytest tests/test_style_library_adopt.py tests/test_style_library.py tests/test_journal_styles_store.py -q > /tmp/p3a-t5.log 2>&1; code=$?; tail -3 /tmp/p3a-t5.log; exit $code
```
Run these mutation proofs, restoring each file afterwards:
1. Drop the `not in adopted` condition; the never-removes test fails.
2. Drop the `take_outline` check; the outline test fails.

- [ ] **Step 5: Commit and push**

Paths: `api/services/journal_two/template_gallery.py api/services/journal_two/db.py api/routers/notebook_template_gallery.py tests/test_style_library_adopt.py tests/_style_library_helpers.py tests/test_style_library.py`. Message: `feat(notebook): adopt a community style as your own copy; notify-me; a previewed additive update (P3a)`.

---

### Task 6: Helpful, author handles, follow, and the feed

**Files:**
- Modify: `S/template_gallery.py`, `api/routers/notebook_template_gallery.py`
- Create: `tests/test_style_library_social.py`

**Interfaces:**
- New tables, in `_DDL`:
  - `j2_gallery_helpful(item_id, user_id, created_at, PRIMARY KEY(item_id, user_id))`
  - `j2_gallery_authors(user_id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, created_at)`
  - `j2_gallery_follows(follower_id, author_id, created_at, PRIMARY KEY(follower_id, author_id))`
- `set_helpful(user_id, gallery_id, on: bool, conn=None) -> dict | None`, returning `{"helpful": bool, "count": int}`. None when the item is not visible to the member or is their own.
- `author_handle(user_id, conn) -> str`: mints a handle on first need.
- `author_page(viewer_id, handle, conn=None) -> dict | None`, returning `{"author": {"handle","label","itemCount","following": bool, "mine": bool}, "items": [...]}`.
- `set_follow(viewer_id, handle, on: bool, conn=None) -> dict | None`, returning `{"following": bool}`. None when the handle is unknown or is the viewer's own.
- `feed(viewer_id, conn=None) -> list[dict]`: listed items by followed authors, newest first, `LIST_LIMIT`.
- `_summary` gains `authorHandle` (a member item only; firm and `ANONYMOUS_AUTHOR` items get the handle too when a member wrote them, because the label is what is anonymous, not the link), plus `helpfulCount` and `helpedByMe`.
- Routes, all 404 with the library off:
  - `POST/DELETE /{gallery_id}/helpful`
  - `GET /authors/{handle}`
  - `POST/DELETE /authors/{handle}/follow`
  - `GET /feed`
  - The literal paths `/authors/...` and `/feed` are declared before `/{gallery_id}`.
  - Helpful and follow have 60/hour in-process limits (`notebook-gallery-helpful`, `notebook-gallery-follow`).

- [ ] **Step 1: Write the failing tests**

```python
from api.services.journal_two import template_gallery as gallery
from tests._style_library_helpers import conn, lib_on, listed_style  # noqa: F401


def test_helpful_is_one_per_member_and_never_your_own(conn, lib_on):
    item = listed_style(conn)
    assert gallery.set_helpful("author", item["id"], True, conn=conn) is None
    assert gallery.set_helpful("m1", item["id"], True, conn=conn) == {"helpful": True, "count": 1}
    assert gallery.set_helpful("m1", item["id"], True, conn=conn) == {"helpful": True, "count": 1}
    gallery.set_helpful("m2", item["id"], True, conn=conn)
    s = next(t for t in gallery.list_gallery("m1", conn=conn) if t["id"] == item["id"])
    assert s["helpfulCount"] == 2 and s["helpedByMe"] is True
    assert gallery.set_helpful("m1", item["id"], False, conn=conn) == {"helpful": False, "count": 1}


def test_a_handle_is_opaque_and_stable(conn, lib_on):
    item = listed_style(conn)
    h = item["authorHandle"]
    assert h and "author" not in h and "@" not in h and len(h) >= 10
    assert gallery.author_handle("author", conn) == h
    assert conn.execute("SELECT handle FROM j2_gallery_authors WHERE user_id = 'author'").fetchone()[0] == h


def test_an_author_page_lists_only_what_is_listed(conn, lib_on):
    item = listed_style(conn)
    conn.execute("INSERT INTO j2_template_gallery (id, user_id, kind, title, description, category,"
                 " body_json, status, created_at, updated_at, item_type) VALUES"
                 " ('p', 'author', 'member', 'Pending', '', 'journal', '{}', 'pending', 'x', 'x', 'style')")
    conn.commit()
    page = gallery.author_page("viewer", item["authorHandle"], conn=conn)
    assert [i["title"] for i in page["items"]] == [item["title"]]
    assert page["author"]["label"] == item["author"] and page["author"]["mine"] is False
    assert "user_id" not in json.dumps(page) and "author\"" not in json.dumps(page["author"])
    assert gallery.author_page("viewer", "nope", conn=conn) is None


def test_follow_and_the_feed(conn, lib_on):
    item = listed_style(conn)
    h = item["authorHandle"]
    assert gallery.set_follow("author", h, True, conn=conn) is None          # not yourself
    assert gallery.set_follow("m1", h, True, conn=conn) == {"following": True}
    assert [i["id"] for i in gallery.feed("m1", conn=conn)] == [item["id"]]
    assert gallery.feed("m2", conn=conn) == []
    assert gallery.author_page("m1", h, conn=conn)["author"]["following"] is True
    gallery.set_follow("m1", h, False, conn=conn)
    assert gallery.feed("m1", conn=conn) == []


def test_social_routes_are_404_with_the_library_off(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    assert gallery.feed("m1", conn=conn) == []
    assert gallery.author_page("m1", "anything", conn=conn) is None
```
Add a TestClient case that calls each new route with the library off and expects 404.

- [ ] **Step 2: Run and see them fail.** Same command shape, file `tests/test_style_library_social.py`.

- [ ] **Step 3: Implement**

Handles:
```python
import secrets


def author_handle(user_id: str, conn: sqlite3.Connection) -> str:
    row = conn.execute("SELECT handle FROM j2_gallery_authors WHERE user_id = ?", (user_id,)).fetchone()
    if row:
        return row["handle"]
    for _ in range(5):
        handle = secrets.token_urlsafe(9)
        try:
            conn.execute("INSERT INTO j2_gallery_authors (user_id, handle, created_at) VALUES (?, ?, ?)",
                         (user_id, handle, _now()))
            conn.commit()
            return handle
        except sqlite3.IntegrityError:
            row = conn.execute("SELECT handle FROM j2_gallery_authors WHERE user_id = ?", (user_id,)).fetchone()
            if row:
                return row["handle"]
    raise RuntimeError("could not mint an author handle")
```
`_SELECT` gains a join, and `_SELECT_LIST` gains the selected columns:
- `LEFT JOIN j2_gallery_authors a ON a.user_id = g.user_id`, selecting `a.handle AS author_handle`;
- a subselect for `helpful_count`;
- a viewer-dependent `helped_by_me`.

Because `helped_by_me` needs the viewer id, add it as a bound parameter. `_SELECT` becomes a function `_select(list_only: bool)` that returns the SQL, and every caller passes `viewer_id` as the first argument for `EXISTS (SELECT 1 FROM j2_gallery_helpful h WHERE h.item_id = g.id AND h.user_id = ?)`. Callers include `list_gallery`, `_row`, `admin_queue` and `author_page`. ⛔ Do this mechanically and run the whole gallery suite: every query that used `_SELECT`/`_SELECT_LIST` changes its argument list.

A member item whose author has no handle row yet still lists, with `authorHandle: null`. `publish_style` and `publish` call `author_handle(user_id, conn)` before their commit, so new and resubmitted items always have one.

`_summary`: `out["authorHandle"] = row["author_handle"] if row["kind"] != "firm" else None`; `out["helpfulCount"] = int(row["helpful_count"] or 0)`; `out["helpedByMe"] = bool(row["helped_by_me"])`.

`set_helpful`:
- return None when the library is off;
- look the row up with `_can_see`, and return None if the item is hidden, not approved, or the viewer is its author;
- `INSERT OR IGNORE` / `DELETE`;
- return the count.

`author_page`:
- resolve the handle to a `user_id` (never returned);
- select items with `_VISIBLE AND g.user_id = ?`;
- set `label` = `_author_label` of the first row, or `ANONYMOUS_AUTHOR` when there are no rows;
- set `mine` = `viewer_id == user_id`, and `following` from `j2_gallery_follows`;
- when the library is off, items are filtered to outlines, the list rule.

`set_follow`: resolve the handle; return None if unknown or the viewer's own; `INSERT OR IGNORE` / `DELETE`.

`feed`: `_VISIBLE AND g.user_id IN (SELECT author_id FROM j2_gallery_follows WHERE follower_id = ?)`, ordered by `COALESCE(g.listed_at, g.created_at) DESC`; `[]` with the library off.

- [ ] **Step 4: Run the tests**, then run the whole gallery suite as well:

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a && python -m pytest tests/test_style_library_social.py tests/test_style_library_adopt.py tests/test_style_library.py tests/test_notebook_template_gallery.py -q > /tmp/p3a-t6.log 2>&1; code=$?; tail -3 /tmp/p3a-t6.log; exit $code
```
Mutation proof: make `author_page` include pending rows; the listed-only test fails. Restore the file.

- [ ] **Step 5: Commit and push.** Message: `feat(notebook): Helpful, opaque author pages, follow and the feed for the community library (P3a)`.

---

### Task 7: Notices on a new version and on withdraw; account deletion

**Files:**
- Modify: `S/template_gallery.py` (`admin_act` approve-revision branch, `unpublish`), `S/account_purge.py`, `docs/account-deletion-manifest.md` (regenerated by its own tool, V11), `tests/test_journal_two_account_purge.py`
- Create: `tests/test_style_library_notices.py`

**Interfaces:**
- `LIBRARY_NOTICE_SOURCE = "notebook_style_library"`
- `UPDATE_NOTICE = "{title} has a new version from its author. Open it to see what changed."`
- `WITHDRAW_NOTICE = "{title} was taken down by its author. Your copy is yours and has not changed."`
- Notices go through `alerts.add_alert(LIBRARY_NOTICE_SOURCE, title, message, severity="info", data={...}, user_id=...)` with the signature V10 confirmed:
  - an update notice carries `data.research_url = "/journal/notebook?styles=1&libraryUpdate=<style_id>"`;
  - a withdraw notice carries no link.
- Rule: after a revision approval, each watcher whose `notified_version < version` gets one notice, and its `notified_version` is set to `version` in the same pass. A delivery that raises leaves `notified_version` unchanged, so the next approval or a retry rings it. Unpublish of a style item rings each watcher once and then deletes the watches. Hide does not ring.

- [ ] **Step 1: Write the failing tests**

```python
from unittest import mock
from api.services.journal_two import template_gallery as gallery
from tests._style_library_helpers import conn, lib_on, listed_style, bump_and_approve  # noqa: F401


def test_an_approved_revision_rings_each_watcher_once(conn, lib_on):
    item = listed_style(conn)
    gallery.adopt_style("w1", item["id"], notify=True, conn=conn)
    gallery.adopt_style("w2", item["id"], notify=True, conn=conn)
    gallery.adopt_style("quiet", item["id"], notify=False, conn=conn)
    with mock.patch("api.services.alerts.add_alert") as add:
        bump_and_approve(conn, item, blocks=[{"block": "myRules", "enabled": True, "settings": {}}])
    users = sorted(c.kwargs["user_id"] for c in add.call_args_list)
    assert users == ["w1", "w2"]
    assert all(c.args[0] == gallery.LIBRARY_NOTICE_SOURCE for c in add.call_args_list)
    with mock.patch("api.services.alerts.add_alert") as add:
        gallery.admin_act("admin", item["id"], "feature", conn=conn)     # no new version: no ring
    assert add.call_count == 0


def test_a_failed_delivery_is_retried_on_the_next_version(conn, lib_on):
    item = listed_style(conn)
    gallery.adopt_style("w1", item["id"], notify=True, conn=conn)
    with mock.patch("api.services.alerts.add_alert", side_effect=RuntimeError("down")):
        bump_and_approve(conn, item, blocks=[{"block": "myRules", "enabled": True, "settings": {}}])
    assert conn.execute("SELECT notified_version FROM j2_gallery_watches WHERE user_id = 'w1'").fetchone()[0] == 1


def test_withdraw_keeps_copies_and_tells_watchers_once(conn, lib_on):
    item = listed_style(conn)
    copy = gallery.adopt_style("w1", item["id"], notify=True, conn=conn)["style"]
    with mock.patch("api.services.alerts.add_alert") as add:
        assert gallery.unpublish("author", item["id"], conn=conn) is True
    assert add.call_count == 1 and gallery.WITHDRAW_NOTICE.format(title=item["title"]) in add.call_args.args
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_watches").fetchone()[0] == 0
    from api.services.journal_two import journal_styles as js
    assert js.get_style("w1", copy["id"], conn)["id"] == copy["id"]
```
Move `_bump` from Task 5 into `tests/_style_library_helpers.py` as `bump_and_approve`.

In `tests/test_journal_two_account_purge.py`, add `test_account_purge_removes_library_rows_and_keeps_copies`, in the file's own style:
- seed an author with a listed style, a handle, a follower and a helpful mark;
- seed a member who follows another author, marked an item helpful, and has a watch and an adopted copy;
- purge each one in turn.
Assert:
- that member's helpful, follow-as-follower, watch and handle rows are gone;
- a purged author's handle, followers' rows pointing at them, and helpful and watch rows on their items are gone;
- every other member's adopted style row is still present.

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement**

A helper in `template_gallery.py`:
```python
def _ring(user_id: str, title: str, message: str, data: dict) -> bool:
    from api.services import alerts
    try:
        alerts.add_alert(LIBRARY_NOTICE_SOURCE, title, message, severity="info",
                         data={"source": LIBRARY_NOTICE_SOURCE, **data}, user_id=user_id)
        return True
    except Exception as e:  # noqa: BLE001 -- a notice never fails an approval or an unpublish
        print(f"[template-gallery] notice to {user_id} not delivered: {type(e).__name__}: {e}")
        return False
```
After the revision-approve UPDATE and its commit, ring the watchers:
```python
            new_version = int(conn.execute("SELECT version FROM j2_template_gallery WHERE id = ?",
                                           (gallery_id,)).fetchone()[0])
            for w in conn.execute("SELECT user_id, style_id FROM j2_gallery_watches WHERE gallery_id = ?"
                                  " AND notified_version < ?", (gallery_id, new_version)).fetchall():
                title = rev["title"]
                if _ring(w["user_id"], title, UPDATE_NOTICE.format(title=title),
                         {"research_url": f"/journal/notebook?styles=1&libraryUpdate={w['style_id']}"}):
                    conn.execute("UPDATE j2_gallery_watches SET notified_version = ? WHERE gallery_id = ?"
                                 " AND user_id = ?", (new_version, gallery_id, w["user_id"]))
            conn.commit()
```
In `unpublish`, before deleting, read the item's `item_type` and `title` and the watcher list. After a successful delete:
- ring `WITHDRAW_NOTICE` to each watcher (data without a link);
- delete `j2_gallery_watches` and `j2_gallery_helpful` rows for the gallery id;
- commit.

`account_purge.py`:
- Add `j2_gallery_helpful` and `j2_gallery_authors` to `_DIRECT_USER_TABLES` (their column is `user_id`).
- Add `j2_gallery_watches` too.
- Add bespoke entries for the cases the direct loop cannot express. Use the indirect block's `_run` shape (`:332-345`):
  - `j2_gallery_follows`: `DELETE ... WHERE follower_id = ? OR author_id = ?`. Check how `_run` binds the user id; if it binds once, write two `_run` entries.
  - `j2_gallery_helpful` on the departing author's items: `DELETE ... WHERE item_id IN (SELECT id FROM j2_template_gallery WHERE user_id = ?)`.
  - `j2_gallery_watches` on the departing author's items: the same shape.
- Regenerate `docs/account-deletion-manifest.md` with the tool V11 named.

- [ ] **Step 4: Run the tests**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a && python -m pytest tests/test_style_library_notices.py tests/test_journal_two_account_purge.py tests/test_style_library_adopt.py tests/test_notebook_template_gallery.py -q > /tmp/p3a-t7.log 2>&1; code=$?; tail -3 /tmp/p3a-t7.log; exit $code
```
Mutation proof: drop the `notified_version < ?` clause, and the once-only test fails because a feature action re-rings. Restore the file.

- [ ] **Step 5: Commit and push.** Message: `feat(notebook): community library notices on a new version and on withdraw; account deletion covers library rows (P3a)`.

---

### Task 8: Contract fixtures and sweeps for every new route

**Files:**
- Modify: `tools/notebook_contract_fixtures.py` (the `template_gallery(w)` writer, `:1310`), `J/__fixtures__/contract/` (the files the tool writes), `tests/test_notebook_contract_fixtures.py` only if it lists routes by hand.

- [ ] **Step 1:** Extend `template_gallery(w)` to write a fixture for each new route, in the shape the existing gallery fixtures use. Run the routes with the library on:
  - `POST /styles`
  - `POST /{id}/adopt`
  - `GET /updates`
  - `GET /updates/{style_id}`
  - `POST /updates/{style_id}`
  - `POST /{id}/helpful`
  - `DELETE /{id}/helpful`
  - `GET /authors/{handle}`
  - `POST /authors/{handle}/follow`
  - `DELETE /authors/{handle}/follow`
  - `GET /feed`

  Add each route to the signed-out and flags-off sweeps. Signed out answers 401. Flags off means the library switch is off, and answers 404. The shape follows `sweep.signed-out.json` / `sweep.flags-off.json`.
- [ ] **Step 2:** Run the tool in write mode (V12), then:
```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a && python -m pytest tests/test_notebook_contract_fixtures.py tests/test_paywall_gate_free_tier.py -q > /tmp/p3a-t8.log 2>&1; code=$?; tail -3 /tmp/p3a-t8.log; exit $code
```
`test_paywall_gate_free_tier.py` must see every new route as paid. If the rail requires a route list, add the routes there. None of them belongs in `LEFT_OPEN`.
- [ ] **Step 3: Commit and push.** Message: `test(notebook): contract fixtures and sweeps for the community library routes (P3a)`.

---

### Task 9: The library UI inside the lazy gallery

**Files:**
- Modify: `J/lib/styleLibrary.js` (calls + hooks), `B/TemplateGallery.jsx`, `B/TemplateGallery.module.css`
- Create: `B/StyleLibraryCard.jsx`, `B/AuthorView.jsx`, `B/StyleLibrary.test.jsx`
- Test: extend `B/TemplateGallery.test.jsx`

**Interfaces:**
- `styleLibrary.js` adds the following. Each mirrors `templateGallery.js`'s `call` shape: it throws an Error carrying the server's sentence, and nothing is swallowed (`swallowedFetch.census.test.js`).
  - `useLibraryList({q, category, sort, section, type, tradingStyle}, {enabled})`
  - `shareStyle({styleId, title, description, category, tradingStyle})` → `{template, droppedProperties}`
  - `adoptStyle(id, {notify})` → `{style, notify, credit}`
  - `markHelpful(id, on)` → `{helpful, count}`
  - `useAuthorPage(handle)`
  - `followAuthor(handle, on)` → `{following}`
  - `useLibraryFeed({enabled})`
  - `useStyleUpdates()`
  - `getUpdatePlan(styleId)`
  - `applyStyleUpdate(styleId, {takeOutline, baseUpdatedAt})`
  - `previewLibraryStyle(item)`, which calls the journal styles preview door V9 named with `{style: {kindId, outlineBodyJson, blocks, properties}}` from `getGalleryTemplate(id)`'s `payload`. ⚠️ `get_item` must return `payload` for a style item: add `out["payload"] = json.loads(row["payload_json"])` there for style rows, plus a server test in `test_style_library.py`.
  - `refreshLibrary()`, which revalidates every key starting with `GALLERY_KEY` plus the journal styles list key.
- `TemplateGallery` keeps every existing behaviour when `styleLibraryEnabled()` is false. Pin this with a test that renders it with the switch off and asserts no "Styles" chip, no trading-style row and no "Following" view.

  When the switch is true, it adds:
  - **Type chips.** "All · Outlines · Styles" (`ITEM_TYPES`). Initial value comes from a new prop `initialType` (default `''`).
  - **Trading-style chips.** All plus `TRADING_STYLES`, shown when the type is Styles or All.
  - **A sort select** using `LIBRARY_SORTS` instead of `GALLERY_SORTS`.
  - **A fourth view chip "Following"**, which renders `useLibraryFeed`.
  - **Style cards rendered by `StyleLibraryCard`.**
- `StyleLibraryCard({item, onPreview, onAdopted, onOpenAuthor, onMessage})` shows:
  - title, author (a button that calls `onOpenAuthor(item.authorHandle)` when there is a handle), trading-style label, "Adopted by N", and "N found this helpful";
  - a **Preview** button: a Sheet showing `previewLibraryStyle(item)`'s composed body through `TemplatePreview`, the line "Rendered with your own data", and "Your own property defaults are not shared" when `droppedProperties > 0` is not known client-side (always show the line for style items);
  - an **Adopt** button opening an inline confirm: a checkbox "Notify me when the author updates" (default off), then **Adopt** and **Cancel**. On success it shows the toast `Added "<title>" to your styles. <credit>.` and calls `onAdopted(style)`. On failure it shows the fixed sentence.
  - a **Helpful** toggle button (`aria-pressed`). It is hidden on your own item.
  - the existing Report flow (reuse `ReportForm` by exporting it from `TemplateGallery.jsx` as a named export).
- `AuthorView({handle, onBack, onMessage})` shows:
  - the author label, "N published", and a **Follow / Following** button (`aria-pressed`, hidden on your own page);
  - the item list using `StyleLibraryCard` for style items and the existing `GalleryCard` for outlines;
  - "Back to the library".

- [ ] **Step 1: Write the failing tests** (`B/StyleLibrary.test.jsx`)

Mock `fetch` the way `TemplateGallery.test.jsx` already does (V13). Cover:
1. Switch off: the gallery renders exactly as before. No "Styles" chip, no "Following" chip.
2. Switch on: the "Styles" chip lists style items with their trading-style label. A trading-style chip filters the request URL (`?type=style&trading_style=swing`).
3. **Adopt with notify.**
   - Tick "Notify me", press Adopt, and the POST body is `{notify: true}`.
   - The toast text is rendered, asserted by text: `Added "Weekend Prep" to your styles. Based on Ana's Weekend Prep.`
4. **Adopt refused.** A 409 shows the server's fixed sentence, and nothing says "Added".
5. **Helpful.** The toggle flips `aria-pressed` and the count text after the response. It is absent on `item.mine`.
6. **Author page.** Pressing the author name opens `AuthorView`. Follow flips to "Following" (`aria-pressed=true`). Back returns to the list with the filters kept.
7. **Following view.** It lists the feed, and when empty says "Follow an author to see their new styles here."
8. **Preview.** It calls the journal styles preview door with the item's `payload`, and the composed heading text renders.
9. Every new control has an accessible name.

- [ ] **Step 2: Run and see them fail.**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a/app && npx vitest run src/pages/journal-2-0/components/notebook/StyleLibrary.test.jsx src/pages/journal-2-0/components/notebook/TemplateGallery.test.jsx > /tmp/p3a-t9.log 2>&1; code=$?; tail -5 /tmp/p3a-t9.log; exit $code
```

- [ ] **Step 3: Implement.**
  - Keep `TemplateGallery.jsx` the default export and add only named exports.
  - Import `styleLibrary.js`, `StyleLibraryCard` and `AuthorView` only from `TemplateGallery.jsx`, which is itself lazy (`TemplatePicker.jsx:86`). Never import them from an eager file.
  - CSS: new controls get `min-height: var(--tap-min)` inside `@media (max-width: 1024px)`, the rule `StylesManager.module.css` uses. Use the existing gallery tokens only.
- [ ] **Step 4: Run the tests plus the rails**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a/app && npx vitest run src/pages/journal-2-0/components/notebook/StyleLibrary.test.jsx src/pages/journal-2-0/components/notebook/TemplateGallery.test.jsx src/pages/journal-2-0/lib/swallowedFetch.census.test.js src/styles/tapFloor.test.js src/components/screener/reachable.test.js src/pages/command/keyListenerCensus.test.js > /tmp/p3a-t9.log 2>&1; code=$?; tail -5 /tmp/p3a-t9.log; exit $code
```
Mutation proof: make the adopt button ignore the checkbox (always `notify: false`). The notify test fails. Restore the file.
- [ ] **Step 5: Commit and push.** Message: `feat(notebook): the community style library inside the gallery: type and trading-style filters, adopt, Helpful, authors, Following (P3a)`.

---

### Task 10: The doors, sharing a style, the update review, the admin preview

**Files:**
- Modify: `B/styles/KindSection.jsx`, `B/styles/StylesManager.jsx`, `app/src/components/admin/TemplateGalleryReviewPanel.jsx`, their tests
- Create: `B/styles/ShareStyleForm.jsx`, `B/styles/StyleUpdateSheet.jsx`, `B/styles/StyleLibraryDoors.test.jsx`

**Interfaces:**
- **`KindSection`.** When `styleLibraryEnabled()` is true, it shows a button "Browse community styles" (UIcon `users` or the nearest existing name; check the registry). Pressing it opens the gallery with `initialType='style'`.
  - It reuses the lazy door `TemplatePicker` uses, with the import inside `StyleSurfaces`' chunk. V14 says where `KindSection` lives.
  - If `KindSection` already lives inside a chunk that can reach `TemplateGallery` only through `TemplatePicker`'s door, raise an event the picker listens for instead of adding an `import()`. The event is `window.dispatchEvent(new CustomEvent('uct:open-community-library', {detail: {type: 'style'}}))`, and the listener lives in `TemplatePicker`.
  - ⛔ A `window` listener counts in `keyListenerCensus` only for key events. A `CustomEvent` listener is not a key listener, but check the census's rule (V-step) before relying on it.
  - Choose the option that adds no eager bytes and say which in the report.
- **`StylesManager`.** Each member style row gains a **Share to community** button. It opens `ShareStyleForm`, which has:
  - title (prefilled with the style name);
  - description;
  - category (`GALLERY_CATEGORIES`);
  - trading style (optional, `TRADING_STYLES`);
  - the line "An admin reviews it before it is listed. Your own property defaults are not shared.";
  - **Submit** and **Cancel**.
  
  On success it says `Sent for review. It is listed once an admin approves it.` When `droppedProperties > 0`, it adds `N of your own property defaults were left out.`
  
  The manager also gains a **Community** button that opens the gallery (same mechanism as `KindSection`) and an **Updates (N)** button when `useStyleUpdates()` is non-empty.
- **`StyleUpdateSheet({styleId, onClose})`.** It loads `getUpdatePlan`, then lists:
  - "Adds blocks: …" (block labels via `blockLabel`);
  - "Adds property defaults: N";
  - when `outlineChanged`, a checkbox "Use the author's new outline" (default off), with a read-only `TemplatePreview` of `newOutline` beside the line "Your outline stays unless you tick this.";
  - the line "Nothing you changed is removed.";
  - **Update my copy** and **Not now**.
  
  On a 409, it shows the fixed sentence and offers **Look again**. The sheet opens from the Updates list. It also opens when the URL carries `libraryUpdate=<styleId>`: `StylesManager` already opens on `?styles=1` (`NotebookTab.jsx:432`), so read `libraryUpdate` inside `StylesManager`, never in `NotebookTab`.
- **`TemplateGalleryReviewPanel`.** For `itemType === 'style'` it renders:
  - kind label, block list, trading style;
  - the outline via `TemplatePreview`;
  - for a revision, the line "Update to a listed style (version N). Approving lists it; the current version stays until then." and `revisionTitle`.
  
  Approve passes `reviewedUpdatedAt` as today.

- [ ] **Step 1: Write the failing tests** (`B/styles/StyleLibraryDoors.test.jsx` plus additions to the review panel test). Cover:
  1. With the switch off, none of the new buttons render.
  2. **Share.** The form posts `{styleId, title, description, category, tradingStyle}`. The success sentence is rendered by text, including the dropped-defaults line when the response says 2.
  3. **Update.** The sheet lists added blocks by label. "Use the author's new outline" is unchecked by default, and Update posts `{takeOutline: false, baseUpdatedAt}`. Ticking sends `true`. A 409 shows the stale sentence and **Look again** reloads the plan.
  4. **Deep link.** `?styles=1&libraryUpdate=s1` opens the sheet for `s1`.
  5. **Review panel.** It shows a style item's block list and the revision line.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** The new files live under `B/styles/` and are reachable only through `styles/lazyStyles.js` → `StyleSurfaces.js`. Add the named exports there, following `loadStyle(name)`'s pattern (`styles/lazyStyles.js`), so no new `import()` is added anywhere. `NoteEditorPage.styleChunks.test.js` must stay green with its pinned count of two.
- [ ] **Step 4: Run the tests plus the rails**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p3a/app && npx vitest run src/pages/journal-2-0/components/notebook/styles/StyleLibraryDoors.test.jsx src/components/admin/TemplateGalleryReviewPanel.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.styleChunks.test.js src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/pages/command/keyListenerCensus.test.js src/styles/tapFloor.test.js src/components/screener/reachable.test.js > /tmp/p3a-t10.log 2>&1; code=$?; tail -5 /tmp/p3a-t10.log; exit $code
```
Mutation proof: default the outline checkbox to checked. The update test fails. Restore the file.
- [ ] **Step 5: Commit and push.** Message: `feat(notebook): share a style, review an author's update, admin style preview, and the library doors (P3a)`.

---

### Task 11: Telemetry, accessibility, the walk, and bytes

**Files:**
- Modify: `J/lib/notebookTelemetry.js` (`NOTEBOOK_EVENTS`, `EVENT_SCHEMAS`), `api/routers/journal_two.py` (`_J2_TELEMETRY_EVENTS`, `_NOTEBOOK_PROP_SCHEMAS`), `J/a11y/notebookSurfaces.js`
- Create: `J/a11y/styleLibrary.a11y.test.jsx`, `tools/notebook_style_library_walk.py`, `docs/notebook/evidence/p3a-walk-<run-id>/`, `docs/notebook/evidence/p3a-bytes-<run-id>/`

- [ ] **Step 1: Add the events.**
  - `library_viewed` with props `{type: oneOf('all','outline','style'), view: oneOf('browse','following','author')}`.
  - `style_adopted` with props `{notify: bool}`.
  - Add them on both sides in the shapes V15 recorded.
  - `TemplateGallery` calls `trackNotebookEvent('library_viewed', ...)` once per view change while the switch is on. `StyleLibraryCard` calls `trackNotebookEvent('style_adopted', {notify})` after a successful adopt.
  - No content and no ids in props.
  - Run `tests/test_notebook_telemetry_events.py tests/test_j2_telemetry_allowlist.py` and `notebookTelemetry.test.js`.
- [ ] **Step 2: Accessibility.**
  - Add `StyleLibraryCard.jsx`, `AuthorView.jsx`, `ShareStyleForm.jsx` and `StyleUpdateSheet.jsx` to `notebookSurfaces.js` with recipes, in the shape of the trader-block rows (`:195-200`).
  - Write `styleLibrary.a11y.test.jsx` running axe on each, with the switch on, in the shape of `traderBlocks.a11y.test.jsx`.
  - Run it plus `J/a11y/surfaceCoverage.test.js`.
- [ ] **Step 3: The walk.** Write `tools/notebook_style_library_walk.py`:
  - **Shape.** Copy the sandbox and two-account shape of the most recent Notebook walk tool V1's commit log names. The header must name its preconditions: a sandbox from the tip, two paid walk accounts on that data dir, `app/dist` rebuilt, `NOTEBOOK_STYLE_LIBRARY_ENABLED=1` and `NOTEBOOK_JOURNAL_STYLES_ENABLED=1` in the sandbox env, and an admin account via `ADMIN_EMAILS`.
  - **Steps:**
    1. Author creates a style and shares it.
    2. The admin approves it in the review panel.
    3. The member browses Styles, filters Swing, previews, adopts with notify, marks Helpful, opens the author page and follows.
    4. The author updates the style and shares again; the listed version is unchanged.
    5. The admin approves the revision.
    6. The member sees the notice, opens Updates, sees "Adds blocks", updates without the outline, and confirms the own-words outline is kept.
    7. The author unpublishes; the member's copy remains and the withdraw notice shows.
  - Each step records PASS, FAIL or INCONCLUSIVE with the rendered text it read, at 1280, 820 and 390.
  - **Run.** From PowerShell, with the data dir single-quoted, outside `C:\data`. Raw output goes to `docs/notebook/evidence/p3a-walk-<run-id>/` and is committed before the summary.
- [ ] **Step 4: Bytes.**
  ```bash
  cd /c/Users/Patrick/uct-worktrees/notebook-p3a/app && npm run build > /tmp/p3a-build.log 2>&1; code=$?; tail -2 /tmp/p3a-build.log; exit $code
  ```
  ```bash
  cd /c/Users/Patrick/uct-worktrees/notebook-p3a && python tools/notebook_perf_budgets.py --dist app/dist > /tmp/p3a-bytes.log 2>&1; code=$?; tail -3 /tmp/p3a-bytes.log; exit $code
  ```
  - Copy the log into `docs/notebook/evidence/p3a-bytes-<run-id>/notebook_perf_budgets.txt` and commit it.
  - The figure must be at or under Task 1 V16 + 400 B.
  - **If it is over**, the fallback is to move the two telemetry schema entries behind a lazy import. Prefer that over any trim to `notebookFlags.js`, because the schemas are needed only on the first `trackNotebookEvent('library_viewed'|'style_adopted')` call. Re-measure, and record both readings.
- [ ] **Step 5: Commit and push.** Message: `test(notebook): library telemetry, a11y, the style library walk and bytes evidence (P3a)`.

---

### Task 12: Gate, final review, PR, and the arming packet

- [ ] **Step 1: Gate.**
  - Make a separate gate worktree on a `notebook-p3a-gate` branch at the branch tip, with a `node_modules` junction.
  - Run `python scripts/gate_shards.py --shards 6 --max-workers 3`, or `2` when Available MBytes is under 8 GB.
  - Commit the raw manifest to the branch before classifying.
  - Classify each NEW failure by running it alone on the branch and on master.
- [ ] **Step 2: Final whole-branch review.** Use the most capable available model; Opus resets 2026-10-19 12pm CT, and before then use Sonnet and say so. Then ONE fix dispatch, one scoped re-review, and an adjudication of the residuals in the ledger.
- [ ] **Step 3: The arming packet.** `docs/notebook/p3a-arming.md` contains:
  - the command `railway variables --service web --set NOTEBOOK_STYLE_LIBRARY_ENABLED=1` (the owner's);
  - the checks after it: the auth payload carries `notebook_style_library_enabled: true`; the style chips render; a share, an approve and an adopt on the smoke account; that account's rows removed through the product's own DELETE / unpublish;
  - the rollback (`=0`, adopted styles stay as ordinary styles);
  - the in-process rate scopes added, so they can join CLAUDE.md's single-process list in a docs commit.
- [ ] **Step 4: Land and open the PR.**
  - Merge `origin/master`.
  - Run `tools/gate_carry_over.py`. Run its owed C4 vitest and pytest on the landing tree.
  - Rebuild and re-measure bytes, then commit the evidence.
  - Open the PR. The body lists the rulings, the evidence paths and the arming packet, and ends with the attribution lines.
  - The owner merges.
  - After the merge, watch promote → web SUCCESS → `hub_nav_smoke --auth` PASS. A failing smoke is rolled back first (H15).

---

## Self-review (done at write time)

1. **Spec coverage, P3 (lines 285-329), each with its task or deferral:**

   | Spec item | Where it lands |
   |---|---|
   | Item types (outline, style) | Tasks 3-4 |
   | Example note | P3b (R-P3-1) |
   | page_layout | P4 |
   | Publishing with review | Task 4 |
   | Sanitizer for text | the reducer (Task 4) |
   | Images off and OCR warnings | P3b (images do not occur in a style payload: the reducer drops them) |
   | Category by trading style, kind and tags | Task 3 (trading style + existing category; free tags NOT built, gap below) |
   | Library door | Task 10 (no tab, R-P3-7) |
   | Filters and sorts | Task 3/9 |
   | Preview with viewer's data | Task 9 |
   | Adopt with credit and notify | Task 5/9 |
   | Explicit previewed merge | Task 5/10 |
   | Authors and follow feed | Task 6/9 |
   | Helpful | Task 6/9 |
   | Report and hide | existing |
   | Withdraw | Task 7 |
   | Data model | Tasks 3, 5, 6 (helpful, follows, uses-with-timestamp) |
   | Item type ONE-FACT rail | Task 3 |
   | Paid gate | every route |
   | Rate limits | R-P3-11 |
   | Dark flag | Task 2 |

   **Gap:** free tags on gallery items are not in this plan. Ruling: defer them to P3b with example notes, because they need the same moderation thought. This is recorded in the ledger at plan time.
2. **Placeholder scan.** Task 5's `_plan` sketch had a placeholder at draft time. It was replaced in place by the full `source_block_ids` version. No "TBD", "TODO" or "similar to" remains.
3. **Type consistency.** These names are used identically in Tasks 4-11:
   - `publish_style`, `style_payload`, `adopt_style`, `list_updates`, `plan_update`, `apply_update`
   - `set_helpful`, `author_handle`, `author_page`, `set_follow`, `feed`
   - `library_enabled`, `LIBRARY_FLAG`
   - `ITEM_TYPES`, `TRADING_STYLES`, `SORTS`
   - `styleLibraryEnabled`, `STYLE_LIBRARY_FLAG`
   - the routes `/styles`, `/{id}/adopt`, `/updates`, `/updates/{style_id}`, `/{id}/helpful`, `/authors/{handle}`, `/authors/{handle}/follow`, `/feed`
4. **Review Focus.** Each of the seven lines has a named test in its owning task.
