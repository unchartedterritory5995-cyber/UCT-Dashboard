<!-- Preserved from .superpowers/audit/session-audit.md, which is git-IGNORED scratch
     that `git clean -fdx` destroys. Body below is the auditor's report VERBATIM; this
     comment is the only addition. Status of its three most serious findings at the time
     of preservation: all three had fixes in flight, none landed. The findings are the
     record; do not edit them to reflect later fixes -- add a follow-up instead. -->

# Adversarial audit — notebook migration (Wave 0 · Wave 3a · transfer gap)

**Date:** 2026-09-02 · **Worktree:** `C:\Users\Patrick\uct-worktrees\notebook-migration` · **Read-only.**
**Method:** every claim below is either a file:line reading or a measurement. Probes ran in the
scratchpad against throwaway SQLite DBs with `AUTH_DB_PATH`/`DATA_DIR`/`J2_ATTACHMENT_ROOT` pinned
there. `C:\data` was never touched. Where I ran something, the output is quoted verbatim.

Judged against the owner's stated objective: *"a user will be able to come in and sync their
notebook and upload it super easily to have transferred all their notes"* — from Notion, Evernote
and Obsidian.

---

## Verdict

**The objective is NOT met for the member it was built for.** The small-library case works. The
migrating member — the only member this wave exists for — walks into a hard wall that is silent,
permanent, and reachable with one ordinary note. Both transfer lanes (file import today, Obsidian
sync tomorrow) fail on the *same* root cause, and neither reports the failure. The way *out* of the
product does not work either: the export cannot be read back by the importer it was written for.

Everything the record claims was built, was built, and most of the fixes are real — the FTS write
tax is genuinely closed (measured), C1's search-coverage regression is closed, C2 is closed with a
rail that can now fail, export cross-tenancy is sound, the export door's reachability rail is the
right shape, and the parity rail found a real bug on its first run. This audit is about the four
things that survived all of that. One pattern recurs: **A3's false claim sits inside the very
docstring written to correct an earlier false claim in the same file** (`notes_export.py:766-783`
opens with *"⛔ This docstring used to assert the opposite"*). The honesty discipline is landing on
the sentence and not on the mechanism.

---

## A1 — CRITICAL. One ordinary note silently and permanently deletes a 200-note batch from an Obsidian member's notebook, and the sync reports `status: "ok"`

**Proven end to end through the real `engine.sync_source`.** 13 notes staged, twelve trivial, one a
1.2 MB markdown file (accepted at ingest by design — `obsidian_staging._MAX_BODY_MD_LEN = 1_500_000`,
`obsidian_staging.py:85`):

```
ingest: {'written': 13, 'skipped': 0, 'manifestReplaced': True}
sync #1 status: ok | created: 0 | failures: ['confirm failed for a batch of 13 note(s): body_json too large (>1MB)']
           notes now in the member's notebook: 0 of 13
           stored cursor -> 2026-09-02T22:36:25.488206+00:00
plugin re-push: {'written': 0, 'skipped': 13, 'manifestReplaced': True}
sync #2 status: ok | created: 0 | notes: 0
sync #3 (one edited note) status: ok | created: 1 | notes: 1
```

Zero of thirteen notes arrive. The cursor advances anyway. The routine re-push cannot recover them.
Only the one note the member manually edited in Obsidian ever comes back. Every pass says **ok**.

### The chain, link by link

1. **Two authorities over "how big may a note be", in two files, neither referencing the other.**
   `obsidian_staging._MAX_BODY_MD_LEN = 1_500_000` (`obsidian_staging.py:85`, set in the I7 round and
   recorded there as *"deliberately generous but arbitrary"*) vs `notes.MAX_BODY_JSON_BYTES = 1_000_000`
   (`notes.py:25`). The ingest boundary is guaranteed to accept a class of note the storage layer
   will always reject.
2. **The real threshold is far lower than 1 MB, because TipTap JSON is not 1:1 with markdown.**
   Measured against the shipped `convert.md_to_tiptap`:

   | note shape | md→JSON blowup | markdown size that hits the 1 MB cap |
   |---|---|---|
   | prose paragraphs | 1.00× | 976 KB |
   | bullet log (daily notes) | **3.45×** | **283 KB** |
   | checkbox task list | **4.08×** | **240 KB** |
   | short headed sections | **4.65×** | **210 KB** |

   Those three shapes *are* an Obsidian trading journal. A running daily-notes file or a year-old
   checklist crosses the wall at ~210–280 KB of text — and ingest happily accepts 5–7× that.
3. **`import_confirm` is all-or-nothing per batch.** One bad note ⇒ `conn.rollback()` and raise
   (`notes.py:426-428`).
4. **The engine confirms in batches of 200** (`engine.py:163 _CONFIRM_BATCH_SIZE`, `:1451`) and
   swallows the whole-batch failure into `failures` (`engine.py:1256-1266`).
5. **The cursor advances regardless of what actually imported.** `engine.py:540-546` publishes
   `provider.opaque_cursor` — set by `list_changed` *before* any fetch or import — unconditionally.
6. **Obsidian has no self-heal.** `engine.py:439` never resets the cursor on a full pass for a
   provider defining `list_present_refs`, and Obsidian defines it. Every timestamp-mode provider
   (Roam/Craft/Notion) gets a full re-list nightly; Obsidian does not.
7. **The plugin cannot bring them back.** `ingest_batch` deliberately does not bump `received_at`
   for unchanged content (`obsidian_staging.py:145-147`), so a re-push is a no-op. Measured above.
8. **The member-facing status is wrong.** `engine.py:549` — `status = "warning" if
   delete_guard_warning else "ok"`. `item_failures` never move the status. This is a guard that
   tests the adjacent thing: the status reports delete-detection health, not import health.

### Why every review missed it

This is **the same defect the security review's C1 named** — *"permanently and silently bricks a
member's sync with no recovery path… keeps reporting `status: ok`"* — reached through a second
door. The C1 fix moved the cursor's *basis* off the client timestamp (correct) and explicitly
declined the other half: *"Did not touch `engine.py`: its cursor-precedence logic and its
non-reset-on-full-pass behavior… are exactly the levers this fix needed."* The fix **depends on**
the mechanism that makes any miss permanent. Task 6's live gate exercised five lifecycle scenarios
over a handful of tiny fixture notes; every unit test does the same. **There is no test anywhere —
unit, parity, or live gate — that syncs or imports a note larger than a few KB.** Note size is the
one property that breaks this feature and the one property nothing measures.

And the hazard was **already named twice in neighbouring code, by earlier review rounds on this
same feature family**:

- `providers/notion.py:105-112` — `_MediaTooLarge` exists specifically so a large media download
  can't get *"base64-embedded into a note's TipTap doc, which would otherwise blow past
  `notes_svc.MAX_BODY_JSON_BYTES` (1MB) during `import_confirm`."*
- `convert/mddoc.py`'s `_strip_unsupported_data_uri_images` (rationale at
  `test_note_convert_mddoc.py:675-687`) exists so a giant data-URI never risks *"the whole note
  tripping `notes.py::MAX_BODY_JSON_BYTES` **with no indication of why**."*

Both mitigations guard the *symptom* on one input shape. Neither author checked what actually
happens when the cap does trip — the answer is not "one note with no indication of why", it is
**the whole 200-note batch, permanently, reported `ok`**. The Obsidian lane then set its own ingest
ceiling 50 % *above* the storage ceiling without referencing either.

**Not security-gated.** This needs no attacker, no leaked token, no malformed payload — one long
note from an honest plugin.

---

## A2 — CRITICAL. The same root cause walls the file-import lane permanently, and re-dropping the export can never get past it

Measured against the shipped `import_confirm`:

```
A: NoteValidationError: tags exceeds cap of 30
A: notes actually written from that 200-note batch = 0
B: NoteValidationError: body_json too large (>1MB)
B: notes written = 0
```

- `commit.js:285` — a failed confirm batch **`break`s the whole run**. Batches are ordered by the
  document list, so the bad note sits at the same index on every attempt.
- The summary tells the member *"Already-imported notes are safe; re-dropping the same export
  resumes where it stopped"* (`commit.js:282-284`). **It resumes to the same wall.** Batch 1's notes
  come back `skipped` (proven: run 2 returns both keys under `skipped`), then batch 2 fails
  identically. A 5,000-note import with one bad note at index 250 can never import notes 201–5,000.
- **Evernote makes the tag ceiling reachable.** `evernote.js:125` reads every `<tag>` with no cap;
  Evernote permits up to 100 tags per note against `notes.MAX_TAGS = 30` (`notes.py:26`). Obsidian
  frontmatter tags are equally uncapped (`obsidian.js parseFrontmatterBlock`).
- **The transfer-gap optimisation removed the only chance to see it coming.** Deferring body
  conversion (`ImportWizard.jsx:596-613`) means the preview never converts a `create` note, so
  nothing client-side can know a note is oversized. The member is told *"Batch 7 failed (HTTP 400:
  body_json too large)"* and given no way to identify or skip the note.

**One root cause, two lanes:** `import_confirm` rejects a whole batch on one note's validation
error, and both consumers treat that as terminal — the client `break`s forever, the engine advances
past it forever.

---

## A3 — HIGH. The export's cancellation shield does not run on a real disconnect; the slot is released by the garbage collector, or not at all

The late review found a genuine defect (an `await` opening the cleanup `finally`, re-raising
`CancelledError`) and fixed it with `anyio.CancelScope(shield=True)`. **The shield works only for
the shape the test drives, which is not the shape Starlette produces.**

Probed against the real production ASGI stack (starlette 0.41.3, anyio 4.12.1, both
`BaseHTTPMiddleware` layers from `api/main.py:6695-6696`, the real `stream_export_file`):

| shape | result |
|---|---|
| client takes a chunk, then disconnects mid-stream — **the realistic case** | after teardown: temp file still on disk, handle open, **`slots_free() == 0`**. Released only once a `gc` pass ran. |
| control: client reads everything | clean |
| cancellation lands before the generator's first `__anext__` | **permanent leak** — file on disk, slot gone, survives 5 × `gc.collect()` |

**Why.** `starlette/responses.py:244-247` — when the task is cancelled at `await send(...)`, the
generator is parked **at its `yield`**, not on an await stack. Python does not close it, so the
`finally` (and therefore the shield inside it) is never reached at cancellation time. Cleanup
happens only when CPython's cyclic collector finalizes the abandoned async generator and asyncio's
asyncgen hook schedules `aclose()`. This is guaranteed by the architecture, not luck: with two
`BaseHTTPMiddleware` layers the app's `send` is a zero-buffer `MemoryObjectSendStream.send()`, so
every chunk is a real backpressure suspension — the generator is *always* parked at the yield when
a slow client goes away.

I confirmed the underlying semantics independently: a never-started async generator's `finally` does
not run even on `aclose()` (`never started -> finally ran: []` vs `started then closed -> ['cleanup']`).
And `journal_two.py:433` is a **sync `def`** that runs `build_export_zip_to_tempfile` (`:459`) in the
threadpool for potentially minutes with the slot already held, before the `StreamingResponse` exists
— that is the window where the permanent variant lives. (Reproduced deterministically against
verbatim Starlette task-group code; not observed arising on its own through the full middleware
stack, so: latent race, not a certainty.)

**Impact.** Default limit is 1, so during every leak window **every member's export 429s** — the
exact outcome `notes_export.py:770-775` says the shield fixed. In the permanent variant it lasts
until redeploy. Temp files orphan with it, and **there is no sweeper**: nothing under `api/`,
`tools/` or `scripts/` ever looks for `j2-notes-export-*`.

**The docstring corrects a false claim with a new one.** *"The shield makes every checkpoint below
run to completion regardless of the caller's cancellation state"* is true only when a checkpoint
below is reached; on a real disconnect none is.

**Why the rail misses it:** `test_notes_export_route.py:197-203` cancels while the generator is
suspended *inside* `__anext__` — a shape a real client cannot produce.
`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`.

**Fix shape:** cleanup must live where cancellation cannot skip it — a `BackgroundTask` on the
`StreamingResponse`, or `contextlib.aclosing` at a level Starlette actually exits — not inside the
generator body. Then rail the shape Starlette *produces* (cancel at `await send(...)`).

### A3b — related, same file: the memory claim the temp-file fix is sold on is also false
`notes_export.py:676-681` says peak memory is *"bounded by whatever one note's markdown + one
attachment's bytes cost transiently."* `notes_export.py:538-542` does
`conn.execute(...).fetchall()` — **every note row, `body_json` included, materialized at once**
before the first `writestr`. The two-full-copies-of-the-zip shape is gone; an unbounded single copy
of the whole corpus is not. There is **no total-archive cap** either — only attachments are capped
(200 MiB, `:89`), and that constant's own rationale (`:81-88`) still cites *"the whole zip is built
in memory"*, the premise the fix removed. Client-side, `ExportDialog.jsx:71` does
`await res.blob()`, so the browser buffers the entire archive anyway.

---

## A4 — HIGH. The export does not round-trip through the importer, and the module docstring says it does

`notes_export.py:4` states the archive is *"one .md per note with YAML front matter, folders as
… — [the format] the importer already ingests"*, and `:620` promises a note comes back *"with its
title, tags and other front matter intact."* **Neither is true.** No test anywhere feeds an export's
output to an importer adapter.

A UCT export zip is detected by the **generic** adapter, not Obsidian: `evernote.detect` → 0 (no
`.enex`), `notion.detect` → 0 (needs ≥30 % hex-suffixed filenames), `obsidian.detect` → 0 (no
`.obsidian/` dir, and exported markdown carries no `[[`), so `detectAdapter` falls through to
generic (`registry.js:38-41`). Only the **Obsidian** adapter has an `extractFrontmatter`
(`obsidian.js:170-178`). `generic.makeFileDoc` (`generic.js:101-135`) calls
`mdToHtml(await readText(vfile))` on the **raw text** — there is no front-matter stripping anywhere
in that file.

**Measured, not argued.** A real export (nested folder, a `:` in the title, subtitle, ticker, a
comma-bearing tag, hero image, inline image) was built with `build_export_zip` and fed through the
**real** `intake.js` → `registry.js` → adapter path under jsdom. Detect scores:
**`evernote 0, notion 0, obsidian 0, file 0.1`** — the archive is claimed by `generic`, and the
adapter the docstring names is never selected for our own export. Result for
`Trading/Setups/AAPL- the thesis.md`:

```
title      : "AAPL- the thesis"        <- from the FILENAME, not title:
tags       : []
folderPath : ["Trading","Setups"]      OK
createdAt  : 2026-09-02T22:37:54.223Z  <- the ZIP FILE's mtime
updatedAt  : 2026-09-02T22:37:54.223Z  <- same
media      : ["attachments/u1/n1/inline/chart.png"]   OK
html       : <hr>
             <h2>title: "AAPL: the thesis"
             subtitle: Why I am long
             ticker: AAPL
             tags: [swing, "reclaim, tight"]
             hero_image: ../../attachments/u1/n1/hero/pic.png
             created: 2024-03-04T10:00:00Z
             updated: 2026-08-31T12:00:00Z</h2>
             <h2>Thesis</h2>…
```

The closing `---` after a paragraph is a **setext H2 underline** in CommonMark, so the front matter
comes back as a visible heading on top of every restored note. Lost: `subtitle` and `ticker` (both
of which `import_confirm` *does* accept — `notes.py:338`, `:385` — and `commit.js:131,134` *does*
forward; only the adapter is missing), all `tags`, `hero_image` (the PNG is in the archive,
referenced by nothing, an orphan blob), and both real dates. Title mangling is permanent:
`_safe_name` (`notes_export.py:397-402`) turns `AAPL: the thesis` into `AAPL- the thesis` and
collision-suffixes `-{id[:8]}`.

**And the counterfactual is not a rescue.** Forcing the Obsidian adapter on the same archive:

```
title: "AAPL- the thesis"                (still the filename)
tags : ["swing","\"reclaim","tight\""]   (obsidian.js:194-204 splits [...] on bare commas,
                                          with no quote awareness — so the encoder's own
                                          correctly-quoted flow sequence is mis-parsed)
createdAt: 2024-03-04T10:00:00Z  OK      updatedAt: <zip mtime>
media: []                                <- EVERY bundled attachment dropped
```

**Generic handles attachments and drops metadata; Obsidian handles metadata and drops attachments.
No single adapter can ingest this export's shape.** Which one runs is also content-dependent — a
member who ever typed `[[` in a note flips `obsidian.detect` to 0.6 and the same archive restores a
different way.

The YAML *escaping* fix (`_yaml_scalar`, `notes_export.py:448-517`) is correct as YAML and was the
right call — but it hardened the emitter of a field the importer never reads. Its own oracle is
weak too: `test_notes_export.py:738-786` asserts mainly against `_decode_yaml_double_quoted`, a
decoder written beside the encoder, and cross-checks with PyYAML only `if yaml is not None` —
**PyYAML is not in `requirements.txt`**, so on the deployed image that independent branch may never
run at all.

**There is no test of this anywhere.** Nothing under `app/src` references `notes_export` or a fixture
produced by it; the export's tests assert its output against themselves and the importer's tests
assert against hand-authored fixtures. This is the whole-branch review's own diagnosis, one wave
later: **a contract crossing a file boundary that no single reviewer owned.**

---

## What the reviews missed — the rest

### B1. `import_check` silently truncates at 5,000 keys
`notes.py:316` — `keys = [...][:5000]`, no warning, no client signal. A member with >5,000 notes
gets a preview that reports updates as creates and collapses the "unchanged" bucket. The wave's
headline benchmark is *5,000 notes*; the truncation sits one note above it. This is the same silent
truncation class the wave's honest-totals work exists to kill.

### B2. The sidebar search renders "100 results" as a fact
`FolderSidebar.jsx:562-563` prints `{serverSearchResults.length} result{s}` against
`limit: SEARCH_RESULT_LIMIT = 100` (`:12`, `:356`), with no total and no "load more". The hook now
returns the true `total` (that is the C2 fix) and the panel does not read it. A migrated member
searching a 5,000-note library is told there are 100 matches. **This is the silent-100-truncation
defect the wave replaced everywhere else, still live in the one surface the wave rewrote.**

### B3. The C5 fix created a new count-vs-list contradiction
`tag_counts` groups by `json_each.value` — **case-sensitive** (`notes.py:667-698`) — while the
`tag=` filter is `lower(tags) LIKE` — **case-insensitive** (`notes.py:561`). Reproduced: three
notes tagged `Earnings`/`earnings`/`EARNINGS` yield three chips of count 1 each, and clicking any
one opens a list headed *"Showing 3 of 3 notes"*. It also splits a tag's true frequency across
rows, so `TAG_CAP = 40` can drop a genuinely-top tag. Two authorities over one value, with no
`tag_counts ⇄ count_notes(tag=)` agreement rail (contrast the one that exists for backlinks).

### B4. Winner-take-all detection silently discards whole platforms, with no warning anywhere
`evernote.detect` returns **1.0** for any `.enex` (`evernote.js`), the maximum, and Evernote is
first in `ADAPTERS` (`registry.js:10`). Every adapter's `parse` filters `vfiles` to what it
recognises and **warns about nothing it skipped**. So a member who follows the new ExportGuide's own
advice — *"drop them all in together and we treat it as one import"* (`ExportGuide.jsx:63`) — and
includes a Notion zip or an Obsidian vault gets **only the Evernote notes**, with a preview count
that looks entirely healthy. Notion's detect additionally requires ≥30 % of *all* files to match
`NOTION_FILE_RE` (`notion.js:54`), so mixing drops it to 0 and Obsidian's 0.95 wins.

### B5. A failed media upload or a failed final PUT is permanent, and the docstring says the opposite
`commit.js:236-238` claims a `skipped` note *"was already fully committed by an earlier run."* False
in two reachable cases: (a) an image upload that failed had its node **dropped** from the body by
`rewriteBody` and the stripped body persisted; (b) a failed PUT leaves literal `import-ref://`
placeholders in the stored body — the code comment at `:334-337` admits this three lines above the
docstring that denies it. Because the fingerprint is over the *incoming payload*, both re-confirm as
`skipped` forever (proven: run 2 returns `skipped` for both keys) and are never re-entered into
`toCommit`. Cross-note links to a batch that failed are dropped the same way, permanently.

### B6. `notes_quota` claims a live read of a value that is frozen at import
`notes_quota.py:24-27` states `disk_watchdog.CRIT_PCT` is *"read live off the module, never copied,
so… two components [can't] silently disagree."* `disk_watchdog.py:40` is
`CRIT_PCT = float(os.environ.get(...))` — an import-time capture. A live env change moves neither.
A comment naming a mechanism it lacks.

### B7. The flag ledger's arming condition is already satisfied, and it should not be
`docs/feature_flags.json` says of `NOTE_SYNC_OBSIDIAN_ENABLED`: *"the mock-plugin live-gate lifecycle
test (that plan's Task 6) has not run yet. **Arm after that test passes.**"* Task 6 has since passed.
An operator reading the ledger — the artifact you read before arming a flag — is now licensed to arm
a surface whose client half does not exist and whose security review says NOT-YET.

---

## Structural fragility (the four recurring shapes, instances still open)

| shape | instance |
|---|---|
| **second authority over one value** | `_MAX_BODY_MD_LEN` (1.5 MB) vs `MAX_BODY_JSON_BYTES` (1 MB) — **A1** · `tag_counts` case-sensitive vs `tag=` case-insensitive — **B3** · attachment root: `notes.py:42` freezes it at import for every **write** (`:1352`, `:1418`) while the *new* `notes_quota._disk_usage()` (`notes_quota.py:84`), `notes.py:1505` and `notes_export.py:126` call `attachment_root()` **live** — in a file whose header declares itself "ONE authority". The whole-branch review asserted the opposite (*"read live per call in notes.py"*) and used that to dismiss the concern. |
| **comment naming a mechanism it lacks** | *"the importer already ingests [this format]"* / *"title, tags and other front matter intact"* — **A4**, the export's whole reason to exist · *"re-dropping the same export resumes where it stopped"* — **A2** · *"a skipped note was already fully committed"* — **B5** · **A3/A3b** — *"the shield makes every checkpoint below run to completion"* and *"peak memory bounded by one note"*, **both written into the docstring that exists to correct an earlier false claim in the same file**, plus the 200 MiB cap's rationale still citing *"the whole zip is built in memory"* (`notes_export.py:81-88`), the premise its own fix removed · `notes_quota`'s "read live" — **B6** · `invalidate_outstanding_codes`' *"fail from now on"* with no restart caveat, sixteen lines below an honest one on `_used_connect_code_nonces` (`obsidian_link.py:112-113` vs `:138-144`) · `notes_search.py:15-17` still says the LIKE path is *"used only when this returns None"* — the tag/ticker LIKE now runs on **every** query. |
| **rail that cannot fail** | the export cancellation rail (**A3**) · the YAML encoder's independent oracle runs only `if yaml is not None` and **PyYAML is not in `requirements.txt`** (**A4**) · `BoundedSemaphore` (`notes_export.py:734`) is asserted nowhere — deleting the word `Bounded` is invisible · **no test anywhere references the search hint string** — C1 *was* a string promising coverage the code lacked; the string was corrected and the mechanism that let it drift was not · `useJ2NoteTags.js` has **no test file at all**, and its failure mode is a silent fall back to the page-derived tag cloud (`FolderSidebar.jsx:381` destructures `tagCounts` and drops `error`) — i.e. C5 verbatim, invisible. |
| **guard that tests the adjacent thing** | sync `status` reports delete-detection health while import failures pass as `ok` (`engine.py:549`) — **A1** · the tag LIKE interpolates the member's query with no `ESCAPE`, so `q="20%"` matches the tag `2024-plan` (reproduced). |

---

## Single-process assumptions this work added (question 6)

Three new pieces of module state, all **correctness guards**, none a cache.

| # | what | file:line | second process | restart |
|---|---|---|---|---|
| 1 | `_connect_code_epoch` (per-user connect-code revocation, closes I6) | `obsidian_link.py:130`, enforced `:233-238`, bumped `:381` | **Breaks in both directions.** Revocation leaks (≈1/N effective) *and* falsely rejects: mint on worker A (epoch 1) → redeem on worker B (epoch 0) → `raise bad`. Every user who has ever disconnected gets a connect flow that only works when mint and redeem hit the same worker, behind a generic "invalid or expired" message. | Dict empties → every epoch returns to 0 → **I6 fully reopens** for the remainder of the 15-min TTL. With `feedback_never_delay_a_deploy` and several redeploys a day, that window is hit routinely. |
| 2 | `_used_connect_code_nonces` (single-use / anti-replay) | `obsidian_link.py:114`, `:239-242` | Single-use becomes single-use-**per-worker**. Each redemption *rotates* the device secret (`:277-284`), so a replayer's second redemption **kills the legitimate plugin's token and installs its own**. `note_sync.py:879-884` argues a rate limiter is redundant *because* of this guard — false premise under >1 process. | Replay window reopens for the TTL. Honestly documented at `:112-113`. |
| 3 | `_EXPORT_SEMAPHORE` (`threading.BoundedSemaphore`, OOM guard) | `notes_export.py:734` | Bound becomes N × limit while the resource (pod RAM, container disk, the shared `/data` volume) is per-**pod**. Default limit 1 ⇒ 4 workers = 4 concurrent multi-minute archive builds, each pinning an anyio thread. The member-facing 429 *"An export is already running"* becomes false. | Benign for the semaphore — and today **restart is the only way to clear the slot A3 leaks**. |

**What breaks first:** #1, and not for a security reason — the *false rejection* makes Obsidian
connect intermittently impossible for any member who has disconnected once. Durable equivalents
already ship in this repo and none was reused: `catalyst/store.try_record_alert`,
`j2_broker_digest_dedup`, and `scheduler_lock.py`'s `flock` (which *is* used, correctly, to keep the
note-sync scheduler single-writer — while `POST /sources/{id}/sync` still relies on the per-process
`engine._inflight_sources`).

**Also import-frozen, undocumented as such:** `NOTE_EXPORT_MAX_CONCURRENT` is evaluated at module
import (`notes_export.py:734`) while its sibling `NOTE_EXPORT_MAX_ATTACHMENT_BYTES` in the same file
is read live per call (`:92-99`, `:552`). A Railway `--set` on the first is inert until the process
is replaced; tests monkeypatching it cannot move it either.

**Boot migrations:** `.notebook_migration_v4`/`v6` gate on flag files in `DATA_DIR` (durable — the
right choice) but with no cross-process lock, so two workers booting together both run v4's full
FTS rebuild (measured 11.5 s at 20,000 notes, synchronous, pre-serve) against a DB with a
deliberately low web-side `busy_timeout`. Convergent, so a latency hazard, not a correctness one.

---

## Question 5 — the C5 / verdict-line gap

The triage promoted C5 to **BLOCK MERGE**; the verdict line named only C1 + C2; the branch shipped.
C5 was fixed afterwards. Auditing the gap:

- **C1 fixed, by the OR-in-LIKE route, not FTS columns.** `notes.py:583-594`. Verified by running the
  SQL: a note whose only signal is the tag `Earnings` is found by `q="earnings"`; with the OR clause
  removed it is missed, so the rails at `test_notes.py:122`/`:136` genuinely fail on revert. Because
  nothing derived changed, the trigger/backfill/migration hazards are moot by construction — a good
  choice. Residual: no rail on the hint string (above), `%`/`_` unescaped in the tag LIKE, and
  `ticker` is a case-sensitive `=` against a column with no `COLLATE NOCASE` while
  `run_notebook_migration_v1` (`db.py:1372-1381`) inserts `symbol or None` raw — a row with
  `ticker='tsla'` is invisible to search *and* to the dedicated `ticker=` filter.
- **C2 fixed and the rail can now fail.** `useJ2Notes.js:56` is `const total = data?.total`. Traced:
  reverting makes `useJ2Notes.test.js:60-72` evaluate `undefined ?? 0` → `0` against
  `expect(total).toBeUndefined()`. The mock now emits a shape the real hook actually produces.
- **C5 fixed for the main case, incompletely.** Counts are now server-derived (`notes.py:667-698`,
  `GET /notes/tags`) and `TAG_CAP` slices the server list. But **B3** (a new case-sensitivity
  contradiction) and the silent fallback to the biased page sample on error (`FolderSidebar.jsx:381`,
  `:389-391`) mean the exact C5 shape is still reachable — now wearing the authority of a
  whole-library SQL count.
- **What else slipped through the gap: B2.** The whole-branch review's own theme was honest counts,
  and the surface it rewrote still prints "100 results" as a fact. Nobody re-read the search panel
  after C2 made the true total available.
- **Not slipped — genuinely closed, and I confirm it:** C3, the FTS write tax. The
  `j2_notes_fts_map` side table is correct under measurement, not just on paper: 5 inserts → (5 fts,
  5 map) rows with matching rowids; an update replaces rather than duplicates (`charlie` → n0,n1,n3,n4;
  `echo` → n2); 20 successive updates to one note leave (5,5) and a single `hotel` hit; a delete
  leaves (4,4). **Median note-save at 7,904 indexed notes: 0.60 ms**, against the 19.09 ms measured
  at 5,000 before the fix. `last_insert_rowid()` inside the trigger does resolve to the FTS5 rowid.

---

## Anything shipped that should not have been

1. **Nothing member-reachable is unready today** — `NOTE_SYNC_OBSIDIAN_ENABLED` is dark, correctly
   registered, and `ConnectTilesCompact` renders no tile for an unconfigured provider.
2. **But the Obsidian door is a dead end the moment it is armed, and nothing says so.**
   `ObsidianConnectModal.jsx:113-115` instructs the member to *"paste it into the plugin's connect
   screen inside Obsidian"* and *"have Obsidian open before you generate it."* **The plugin does not
   exist** — Wave 3b was scoped to a separate, unpublished repo. There is no download link and no
   honest "not available yet" line. Combined with **B7** (the ledger's arming condition is now
   satisfied) and a security review whose activation gate lists only security items, the flag is one
   `railway variables --set` away from shipping an impossible instruction to paying members.
3. **`build_export_zip` is production-dead** (`notes_export.py:645`, tests only) — correctly railed
   against re-adoption at `test_notes_export_route.py:134`. Not a problem; noted so it is not
   re-flagged.

---

## What I would stop from shipping further

1. **Do not arm `NOTE_SYNC_OBSIDIAN_ENABLED`** until A1 is fixed *and* the plugin exists. A1 is not
   a security bug, so the security review's gate does not cover it; A1 alone makes the feature lose
   member data silently.
2. **Do not add any new consumer of `import_confirm`** until per-note failures are isolated from the
   batch. One note must not be able to reject 199 others (A1, A2).
3. **Do not treat "the live gate passed" as coverage for scale.** Task 6 and every unit test use
   notes of a few KB. The one property that breaks this feature — note size — is untested everywhere.

### Ranked fixes

1. **A1/A2 — make `import_confirm` per-note fault-tolerant** (return a `failed[]` bucket instead of
   rolling back the batch), and **do not advance the Obsidian cursor past a ref that did not import**.
   Reconcile `_MAX_BODY_MD_LEN` with `MAX_BODY_JSON_BYTES` so ingest cannot accept what storage
   refuses. Make `item_failures` move the sync `status` off `"ok"`.
2. **A3 — move the export cleanup out of the generator body** (a `BackgroundTask` on the
   `StreamingResponse`), and re-rail it against the shape Starlette actually produces (cancel at
   `await send(...)`), not the shape that is convenient to write. Add a `j2-notes-export-*` sweeper.
   Separately, stream the note rows instead of `fetchall()` (A3b) and correct the two docstrings.
3. **A4 — teach the generic adapter to strip and honour YAML front matter** (and give `obsidian.js`
   a quote-aware flow-sequence parser), then add the one rail this whole feature is missing:
   *export a library → feed the archive to `detectAdapter` + `parse` → assert
   title/subtitle/ticker/tags/dates/media all survive.* One test would have caught every item in A4
   on the day it shipped, including that the archive is claimed by the wrong adapter.
4. **B4 — warn on every file an adapter skipped**, and surface a second-place detection above a
   threshold rather than discarding it silently.
5. **B2 — show the true search total** (or "showing the first 100"), reading the `total` C2 made real.
6. **B3 — one casing authority for tags**, plus a `tag_counts ⇄ count_notes(tag=)` agreement rail.
7. **B1 — return a truncation flag from `import_check`** rather than silently capping at 5,000.
8. **Move `_connect_code_epoch` and the nonce set to auth.db** before any thought of a second worker;
   today's restart window already reopens I6 on every redeploy.

---

## Verified sound — recorded so it is not re-audited

- FTS write tax (C3) genuinely fixed and measured; the `last_insert_rowid()` mapping is correct.
- C1 search coverage restored and the hint string is now honest; cross-tenant scoping correct.
- C2 fixed with a rail that can fail.
- Export cross-tenancy: identity check plus SQL-level `WHERE user_id = ?`; no leak found.
- Export door now has a real reachability rail (`NotebookTab.test.jsx:196-210`) — real tab, real
  toolbar button, unmocked dialog, with a non-vacuous `queryBy…not.toBeInTheDocument()`
  pre-assertion. Delete the button or cut the `open` wire and it goes red. The late review's
  "built, green, no door" finding is genuinely closed.
- Export items 1 (temp file, not double-in-memory), 3 (`BoundedSemaphore`), 4 (gzip exemption,
  railed at `tests/api/test_sse_gzip_exempt.py:20-26`) and 6 (hero resolver + `writestr` moved
  inside the per-note guard, `notes_export.py:126-141`, `:213-224`, `:592-600`) are all really fixed.
- The attachment cap is enforced against real `stat().st_size` bytes with a pre-check before the
  read, and an over-cap file is named in `EXPORT_ISSUES.txt` rather than dropped silently.
- Export temp files land on ephemeral container `/tmp`, **not** the `/data` volume — nothing on the
  web pod sets `TMPDIR` (only `api/bars_api_main.py`, a different service). Worth one `railway
  variables --service web --kv | grep -i tmp` to confirm, since that file's own comment implies
  Railway may inject one.
- The three `compare_digest` BYTES fixes; fail-closed `_signing_secret`; encryption at rest; the
  device-token PK-then-decrypt path — all sound, blast radius bounded to one `(user_id, vault_id)`.
- `obsidian_staging.py` has zero in-memory state; every I3/I4/I7 bound is checked inside the same
  transaction and is correct under multiple processes.
- `registry._obsidian_configured()` really is read live per call, as its docstring claims.
- The Notion trash-sweep fix, the wikilink-with-a-space fix and the cross-lane parity rail are real
  and correctly reasoned.
