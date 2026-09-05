# Notebook Connectors — 60-User Reliability & Migration-Friction Certification

**Date:** 2026-09-05 · **Scope:** Notion (connect + continuous sync), Obsidian (published plugin + continuous sync), Evernote (import/migration only).

---

## 1. Executive result

**CERTIFIED WITH DOCUMENTED LIMITATIONS.**

60 synthetic member journeys were run against the real product — 20 Notion, 20 Obsidian, 20 Evernote. Every journey passed its reliability bar. No hard failure occurred: no silent note loss, no cross-user leakage, no wrong-account attribution, no lost member edits, no destructive conflict, no uncontrolled duplicates, no attachment corruption, no false success, no case of one bad note blocking healthy notes, and no disconnect/revocation security failure.

Four migration-friction defects were found by *walking the product as a member* and were fixed and shipped during this certification. The most important: **connecting a source did not start the import.** A member who finished Notion's OAuth landed on an empty Notebook with nothing running, and only saw their notes when an hourly tick happened to fire — up to 60 minutes later. The same held for a pushed Obsidian vault.

The limitations that remain are documented in section 11, and none of them involves losing or misrepresenting member content.

---

## 2. Provider scoreboard

| Provider | Journeys | Reliability coverage | Format constructs | Hard failures | Verdict |
|---|---|---|---|---|---|
| Notion | 20 / 20 pass | edit, add, trash, 2-strike delete, conflict fork, idempotent resync | 24 / 24 | 0 | PASS |
| Obsidian | 20 / 20 pass | push, edit, rename, move, delete, revoke, reconnect, 20-cycle soak | 17 / 17 (1 documented normalisation) | 0 | PASS |
| Evernote | 20 / 20 pass | import, multi-notebook, media, tags, re-import idempotency | full ENML matrix | 0 | PASS |

---

## 3. Migration-friction audit (measured, not estimated)

Every count below was obtained by performing the journey in the browser. "UCT" = friction we create. "Provider" = unavoidable third-party step.

### Notion

| | Member actions | UCT | Provider |
|---|---|---|---|
| BEFORE | 6 + wait up to 60 min | 4 (Connect, consent, Continue, **find and press "Sync now"**) | 2 |
| AFTER | 5, import automatic | 3 (Connect, consent, Continue) | 2 |
| TARGET | 3 | 1 | 2 |

### Obsidian

| | Member actions | UCT | Provider |
|---|---|---|---|
| BEFORE | 8 + wait up to 60 min | 6 (Connect, consent, Generate, Copy, Paste+Connect, **"Sync now" in plugin**, **"Sync now" in UCT**) | install plugin |
| AFTER | 6, import automatic | 5 (Connect, consent, Generate, Copy, Paste+Connect) | install plugin |
| TARGET | 4 | 2 | install + paste |

### Evernote

| | Member actions | UCT | Provider |
|---|---|---|---|
| BEFORE / AFTER | 3 | 2 (Import, confirm Import) | 1 (choose ENEX) |
| TARGET | 3 | 2 | 1 |

**Evernote is already at target.** Detection is automatic ("Detected source: Evernote"), everything is pre-selected, the destination folder is defaulted, and no parser/format/mapping question is ever asked.

### Friction removed during this certification

| # | Friction | Classification | Fix |
|---|---|---|---|
| F1 | Notion OAuth created the source but never started the first sync | UCT-created | `c3243d93d` — callback starts the import |
| F2 | A completed Obsidian vault push stayed staged until the hourly tick | UCT-created | `c3243d93d` — a `final` ingest drains immediately |
| F3 | Plugin said the vault "is now syncing" and started nothing | UCT-created (and false copy) | plugin `0.1.4` — connect imports, notice reports what landed |
| F4 | OAuth return landed on Settings -> Account, not Connections | UCT-created | `8f1d4accf` — every return names `section=connections` |

### Retained deliberately

One consent checkbox per connector. It is a privacy authorisation (and is enforced server-side), not a technical question. Folding it into the button as implied consent would remove a click at the cost of an explicit data-sharing affordance — that is the owner's call, not a defect.

---

## 4. Format conversion matrix

Expectations were **derived from the shipped converters** (`convert/mddoc.py`, `convert/notion_blocks.py`, `adapters/evernote.js`), not invented, then checked against what actually landed.

### Notion -> UCT (24/24 EXACT)

plain · H1 · H2 · H3 · bold · italic · bold+italic · strikethrough · inline code · code block · bullet list · numbered list · unchecked task · checked task · quote · divider · link · link with encoded spaces · **callout -> native callout** · **toggle -> native toggle** · **toggleable heading -> toggle** · emoji · unicode · punctuation.

### Obsidian -> UCT (17/17)

EXACT: headings · bold · italic · strike · inline code · code block · bullet list · numbered list · nested list · list items · task list · task items · table · blockquote · horizontal rule · link.

SEMANTIC: wikilink · wikilink alias (alias text preserved) · wikilink with spaces · unicode filenames and bodies · duplicate basenames in separate folders (both preserved).

**EXPECTED NORMALIZATION:** Obsidian callout `> [!note]` -> blockquote; `mddoc.py` has no callout node. Meaning preserved, representation differs.

### Evernote -> UCT

EXACT: bold · italic · bold+italic · strikethrough · H1-H3 · bullet list · numbered list · `<en-todo>` -> task list with checked state preserved · tables · external links · tags · unicode titles and bodies · duplicate titles kept distinct.

SEMANTIC: `<en-media>` image -> inline image; non-image resource -> attachment chip with its real filename; unreferenced resources appended as chips rather than dropped.

EXPECTED NORMALIZATION: Evernote monospace span -> `textStyle` mark, not a `code` mark (an Evernote monospace span is not semantically code). `evernote:///` internal deep links unwrap to plain text (the link has no meaning outside Evernote).

EXPECTED WARNING (visible, never silent): `<en-crypt>` -> a literal `[encrypted content — cannot be imported]` paragraph, with surrounding content intact.

**Media integrity was verified by bytes, not by presence:** the inline image served `image/png` with PNG magic `89 50 4e 47`; the attachment chip served `application/pdf` with `%PDF-1.4`. Distinct URLs, correct MIME, correct magic — no attachment corruption.

---

## 5. The 60 journeys

### Notion (N01-N20) — 20/20 pass

| IDs | Source corpus | Source -> UCT | Operations | Result |
|---|---|---|---|---|
| N01-04 | 31 pages: full golden corpus + tiny / long title / duplicate titles / many headings / near-limit / very large | 31 -> 31 | initial sync + full format matrix | PASS, 24/24 constructs |
| N05-08 | 8 pages | 8 -> 8 | remote edit, resync, add note, idempotent resync | PASS, update not duplicate |
| N09-12 | 10 pages | 10 -> 10 | edit, trash, deletion passes, resync | PASS, severed and tagged, body retained |
| N13-16 | 6 pages | 6 -> 6 | member edit vs remote edit, conflict, resync | PASS, member edit survived, fork created |
| N17-20 | 23 pages incl. very large + many headings | 23 -> 23 | edit, trash/delete, conflict, resync | PASS |

Evidence: deletion `pass1Deleted: 1` (the explicit trash sweep severs in one pass), note tagged `source-deleted` and **retained**; conflict `{conflicts: 1, forks: 2, memberEditSurvived: true}`.

### Obsidian (O01-O20) — 20/20 pass

| IDs | Vault | Files -> UCT | Operations | Result |
|---|---|---|---|---|
| O01-04 | 11 files: formats, wikilinks/aliases, embeds, unicode filename, nested folders, duplicate basenames | 11 -> 11 | initial push + format matrix | PASS |
| O05-08 | 13 files incl. a 400 KB note | 13 -> 12 | oversized among healthy | PASS — refused **and named** (`tooLarge: ["Oversized.md"]`); healthy sibling landed |
| O09-12 | 12 files incl. a ~192 KB note | 12 -> 12 | near-limit | PASS |
| O13-16 | 11 files | 11 -> 12 | edit + rename + move + delete, then deletion pass | PASS, `sourceDeleted: 2`, tagged, bodies retained |
| O17-19 | 11 files | 11 -> 11 | disconnect, revoked token, reconnect, resync | PASS, revoked push **HTTP 401**, no duplicates |
| O20 | 11 files | 11 -> 11 | 20 consecutive unchanged syncs | PASS, count never moved |

### Evernote (E01-E20) — 20/20 pass

20 ENEX notebooks, 173 notes, imported through the real Import wizard.

| IDs | Notebook shape | Notes | Result |
|---|---|---|---|
| E01-E03 | formats, lists, checklists, links, tables, tags | 4 each | created 4/4 each, 0 needing attention |
| E04-E06 | multi-notebook import (3 files at once) | 12 | **3 folders created, one per .enex** |
| E07-E10 | + images, PDFs, unreferenced resources | 24 | 12 media items, all resolved |
| E11-E15 | + unicode, long titles, duplicate titles, tiny, encrypted block | 50 | encrypted block surfaced as a visible placeholder |
| E16-E20 | + a ~540 KB note among healthy notes | 75 | all 75 created, 0 needing attention |
| re-import | E01 + E07 re-dropped | 10 | **"Will create 0 · update 0 · unchanged 10"**, Import button disabled |

---

## 6. Concurrency

5 Notion members and 5 Obsidian vaults syncing **simultaneously**, three full cycles each, each member's content uniquely marked.

- wall clock **3.05 s**, **zero** HTTP errors, zero timeouts, zero database-lock failures
- every member ended with exactly **8** notes (repeat cycles created no duplicates)
- **CROSS-USER LEAKAGE: NONE** — no member's notebook contained another member's marker, in either direction, and no Obsidian content appeared in a Notion member's notebook or vice versa

---

## 7. Soak / idempotency

- Obsidian O20: 20 consecutive unchanged full pushes; note count never left 11.
- Notion: idempotent resync in every journey; counts stable.
- Notion reconnect in **production** through real OAuth: `notesSkipped: 10, created: 0`, notebook total unchanged — **no duplicates on reconnect**.
- Evernote re-import: `unchanged 10`, nothing created.

---

## 8. Failure injection

| Injected | Result |
|---|---|
| Oversized note among healthy notes (Obsidian) | Refused **and named** in `tooLarge`; 12 of 13 landed; healthy sibling unaffected |
| Very large note among healthy notes (Evernote, ~540 KB) | All 75 notes created; slow (see section 9), never lost |
| Auth revoked mid-life (Obsidian) | Next push **HTTP 401**; plugin cleared its own token and reported `needsReconnect` |
| Disconnect then reconnect | Reconnect succeeded; no duplicates; plugin's staged state correctly cleared |
| Malformed / undecodable content (`<en-crypt>`) | Visible placeholder, neighbours intact |
| Partial batch (intermediate ingest) | Not swept; only a `final` batch drains, so a partially-pushed vault is never imported |
| Concurrent same-source syncs | In-flight guard answers "busy"; never a double import |

---

## 9. Performance observations

| Observation | Measurement |
|---|---|
| 10 members syncing concurrently | 3.05 s wall clock |
| Notion 31-page corpus, full sync | sub-second per journey |
| Obsidian 11-file vault, connect to notes in Notebook | **~5 s end to end**, one member action |
| Notion production OAuth to notes imported | automatic, complete within seconds of the redirect |
| **Evernote 5 x ~540 KB notes** | **~4 minutes**, browser UI unresponsive during conversion; progress counter appeared stuck at 70/75 |

---

## 10. Defects found and fixed

| # | Defect | Severity | Status |
|---|---|---|---|
| 1 | Connecting Notion never started the first import; member saw an empty Notebook for up to 60 min | Major (migration) | Fixed `c3243d93d`, verified in production |
| 2 | A completed Obsidian vault push stayed staged until the hourly tick | Major (migration) | Fixed `c3243d93d`, verified in production |
| 3 | Plugin claimed the vault "is now syncing" while starting nothing | Major (false member-facing copy) | Fixed in plugin `0.1.4`, verified in a real vault |
| 4 | OAuth return landed on Settings -> Account instead of Connections | Minor | Fixed `8f1d4accf` |

Two existing guards had to be *repaired rather than re-baselined* when defects 1 and 2 were fixed: a test that proved "Notion never takes the OneNote branch" by counting `build_provider` calls could no longer distinguish that branch from the new (intended) background sync, and the ingest module's step-by-step tests asserted on their own sync's counts. Both were corrected to keep measuring what they were written to measure; neither was weakened.

**Every rail added was mutation-verified.** The ingest rail fails both when the drain never fires *and* when it fires on every batch.

---

## 11. Known limitations

1. **Large Evernote notes block the import UI.** Notes of a few hundred KB convert on the browser main thread; five such notes took about 4 minutes with the tab unresponsive and the progress counter apparently stuck. The import completes correctly and loses nothing, but a member with very large notes will think it has hung. Not fixed: this is a UX risk rather than a correctness defect, and off-main-thread conversion is larger than this certification's remit.
2. **Deletions reflect on the nightly full pass.** "Sync now" is incremental by design; delete detection needs a full enumeration and runs on the 01:47 ET sweep. A member who deletes remotely and syncs manually sees no change until then.
3. **Obsidian callouts normalise to blockquotes.** `mddoc.py` has no callout node. Meaning preserved.
4. **A rename in Obsidian is a delete plus a create.** Note identity is the vault path; there is no stable per-note id on the wire. Content is never lost, but the old path is severed and tagged.
5. **The plugin's Server URL field is member-editable and unvalidated.** An invalid value produces an opaque "Invalid URL" failure with no guidance. Found by accidentally writing into it during this certification.
6. **The Obsidian size ceiling is an ingest-path constraint, not a Notion one.** A 630 KB note imported through Notion stored in full, uncut.

---

## 12. Certification scope and honesty statement

- **Notion:** 1 journey through **real production OAuth against a real Notion workspace**; 19 through the real sync engine, real converters and real storage with a synthetic Notion remote. There is no way to own 20 Notion workspaces; the remote is the only synthetic element, supplied through `registry.build_provider` (the project's own live-gate seam), and it runs the **shipped** `NotionBlockConverter`.
- **Obsidian:** 1 full journey with the **publicly released plugin (0.1.4) against production**, and 20 through the real `/obsidian/redeem` + `/obsidian/ingest` HTTP protocol with real device tokens, real staging and the real engine.
- **Evernote:** all 20 through the **real Import wizard in the browser** against production, with real ENEX files carrying real PNG and PDF bytes.
- **60 distinct member identities** exist in the sandbox, which is what makes cross-user isolation testable at all. The production journeys necessarily ran on the single real account available.
- All production test residue was removed: 192 notes and 25 folders deleted, the Notebook restored to its pre-certification 31 notes, the test vault disconnected. `NOTE_SYNC_OBSIDIAN_ENABLED` remains armed.

---

## 13. One-click migration scorecard

| Provider | Primary action | Required human actions | Automatic conversion | Automatic initial import | Technical decisions | UX verdict |
|---|---|---|---|---|---|---|
| Notion | "Connect" | 3 UCT + 2 Notion | Yes | **Yes (new)** | None | GOOD — one consent tick above target |
| Obsidian | "Connect" | 5 UCT + plugin install | Yes | **Yes (new)** | None | GOOD — the code hand-off is inherent to a local app |
| Evernote | "Import" | 2 UCT + 1 file choice | Yes | Yes | None | **AT TARGET** |

**Final standard check.** A member never chooses a parser, a conversion mode, a markdown/HTML setting, a resource mapping, a folder mapping, a sync mode, or a conflict policy. Selection defaults to everything. Results are reported honestly, with a "needs attention" column that stayed at "—" throughout, and refusals are always named.

---

## 14. Final verdict

**CERTIFIED WITH DOCUMENTED LIMITATIONS**

60 of 60 journeys passed. Zero hard failures. Migration is now a one-action import on all three paths. The limitations in section 11 are real, are documented, and none of them causes a member to lose content, meaning, formatting, ownership, or trust.

---

# MIGRATION UX CLOSURE (2026-09-05)

Added after the original certification. The evidence above is unchanged.

## 15. Evernote large-import responsiveness

### Where the time actually goes (measured before changing anything)

A single ~534 KB Evernote note, instrumented in the deployed app:

| Phase | Measurement |
|---|---|
| ENEX parse (XML + ENML) | **~120 ms** — not the bottleneck |
| Attachment/resource handling | included above; not material at this size |
| **`htmlToNote` conversion** | **the blocking cost** |
| Backend persistence / commit | ~26 s, network-bound, **non-blocking** |
| Frontend rendering / preview | negligible |

A Web Worker was **not** chosen, because the measurement does not justify it: `sanitizeHtml` uses `DOMParser` and TipTap's `generateJSON` also parses through the DOM. Neither exists in a Worker, so moving conversion off-thread means replacing the HTML parser underneath an already-certified conversion path. The smaller solution was taken instead, exactly as instructed.

### What was actually wrong

The conversion loop yielded **every 10 notes**. A notebook whose last five notes were large therefore ran one unbroken synchronous block — which is precisely why the original certification saw the counter frozen at "70/75" on an unresponsive tab.

### A regression this pass introduced, caught by re-measuring

Yielding per note with `setTimeout` made it *worse* for a backgrounded tab: Chrome **intensively throttles chained timers** in a hidden tab to one per minute. Measured on the deployed build: a 15-note import took **246 seconds**, its 15 progress updates ~60,000 ms apart. A one-off `setTimeout(0)` still returns in ~0 ms in that same tab, which is why a spot check misses it. Fixed by yielding through `MessageChannel`, which is not on the timer budget — the mechanism React's own scheduler uses, for this reason.

### BEFORE / AFTER — the exact pathological certification case

75 notes across 5 notebooks, five of them ~540 KB, identical shape in both runs.

| | BEFORE | AFTER |
|---|---|---|
| Wall clock | ~4 minutes | **30 seconds** |
| UI responsiveness | tab unresponsive; batched calls timed out | responsive; no gap > 120 ms |
| Progress behaviour | froze at "70/75" | **75 updates — one per note** |
| Max gap between updates | the whole tail in one block | **120 ms** |
| Gaps > 2 s | yes | **0** |
| Large notes explained | no | **5 named before their pause** |
| Notes imported | 75 | 75, NEEDS ATTENTION "—" |

The progress line now shows the note being converted and, only when the note is genuinely large, a line naming it as a large note that can take a moment, plus a reassurance that the window can be left open while UCT finishes. No fabricated percentage; nothing the frontend cannot observe. The import remains resumable, idempotent, honest on failure, and safe when a single note is unusually large.

## 16. Action-count audit

### Notion — 5 actions, enumerated

| # | Action | Classification |
|---|---|---|
| 1 | Click **Connect** on the Notion row | UCT — the primary action itself |
| 2 | Tick the consent checkbox | UCT — privacy authorisation, **server-enforced** (`if not body.consent` returns 400) |
| 3 | Click **Continue** (submits consent, starts OAuth) | UCT — submit for #2 |
| 4 | Notion: **Select pages to access** | UNAVOIDABLE PROVIDER |
| 5 | Notion: **Allow access** | UNAVOIDABLE PROVIDER |

Everything after successful authorisation is now automatic: the callback starts the import, conversion runs, folders are created, and the member returns to the Connections section with the source already syncing.

**Why 3 is not reachable without a product decision.** Actions 2 and 3 exist only to obtain explicit consent before UCT touches a third-party account. That consent is independently enforced by the server, so it is not decoration. Reaching 3 means folding it into the button as implied consent ("by clicking Connect you authorise..."), which trades an explicit data-sharing affordance for one click. That is the owner's call, not friction for this pass to delete — the instruction was not to sacrifice consent merely to reduce the number. **5 is therefore the minimum with an explicit consent control; 3 is reachable only by removing it.**

### Obsidian — 6 actions, one removed this pass

| # | Action | Classification |
|---|---|---|
| 0 | Install the plugin | UNAVOIDABLE — Obsidian is a local app |
| 1 | Click **Connect** | UCT — primary action |
| 2 | Tick consent | UCT — server-enforced privacy authorisation |
| 3 | Click **Generate code** | UCT — submit for #2 |
| ~~4~~ | ~~Click **Copy**~~ | **REMOVED** — the code now lands on the clipboard as it is minted |
| 5 | Paste the code, click **Connect** in Obsidian | UNAVOIDABLE — the local app cannot read UCT's session |

Connecting the vault still scans, pushes, converts and populates UCT with no further "Sync now", exactly as certified. The plugin flow itself was not redesigned.

### Evernote — unchanged, at target

Import, choose ENEX, then automatic detection, conversion and import. No continuous sync was reopened; no conversion settings were added.

## 17. FULL CONVERSION FIDELITY MATRIX

Per-note source-to-destination comparison, not corpus-level presence. Automated checks: **1,744** (1,200 Notion + 544 Obsidian) across 40 sandbox journeys, plus byte-level media verification and rendered-DOM checks in production.

| Construct | Provider | Source | Converted | Structural | Rendered | Media | Round-trip | Warnings | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| Paragraphs / prose text | Notion | 20x31 pages | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Prose text (word-level survival) | Obsidian | 20x10 files | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Headings H1-H3 | both | all | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Bold / italic / bold+italic | both | all | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Strikethrough | both | all | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Inline code | both | all | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Code blocks | both | all | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Blockquotes | both | all | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Horizontal rules | both | all | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Bullet / numbered / nested lists | both | all | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Task lists + checked state | all three | all | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Tables (rows/cells) | all three | all | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Callouts to native callout | Notion | 20 | 20 | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Toggles to native toggle | Notion | 20 | 20 | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Toggleable headings to toggle | Notion | 20 | 20 | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| **Block ORDER within a note** | Notion | 20 combo notes | 20 | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| External links + labels + targets | all three | all | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Wikilinks / aliases / spaces | Obsidian | 20x3 | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Duplicate basenames kept distinct | Obsidian | 2 per vault | 2 | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Nested folder paths | all three | all | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| **Images (PNG/JPEG/GIF)** | Evernote | 9 | 9 | PASS | **PASS — decoded, correct natural dimensions** | **PASS — byte-identical** | PASS | 0 | CERTIFIED |
| **Image order/placement between text** | Evernote | 9 | 9 | PASS | PASS | PASS | PASS | 0 | CERTIFIED |
| **Attachments (PDF / text)** | Evernote | 3 | 3 | PASS | PASS | **PASS — byte-identical** | PASS | 0 | CERTIFIED |
| Unicode media filename | Evernote | 1 | 1 | PASS | PASS | PASS | PASS | 0 | CERTIFIED |
| Unreferenced resources | Evernote | 1 | 1 | PASS | PASS | PASS | PASS | 0 | CERTIFIED |
| Tags | Evernote | all | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Created/updated metadata | Evernote | all | all | PASS | PASS | N/A | **PASS — `created` survives into export** | 0 | CERTIFIED |
| Emoji / Unicode / punctuation | all three | all | all | PASS | PASS | N/A | PASS | 0 | CERTIFIED |
| Obsidian callout to blockquote | Obsidian | 20 | 20 | INTENTIONALLY NORMALIZED | PASS | N/A | PASS | 0 | CERTIFIED (documented) |
| Evernote monospace to textStyle | Evernote | all | all | INTENTIONALLY NORMALIZED | PASS | N/A | PASS | 0 | CERTIFIED (documented) |
| Encrypted blocks | Evernote | all | all | UNSUPPORTED WITH HONEST WARNING | PASS — visible placeholder | N/A | PASS | visible | CERTIFIED (documented) |
| Evernote internal deep links | Evernote | all | all | INTENTIONALLY NORMALIZED — unwrapped to text | PASS | N/A | PASS | 0 | CERTIFIED (documented) |

### Media fidelity detail (byte-level)

| Asset | MIME | Source bytes | Served | SHA-256 | Verdict |
|---|---|---|---|---|---|
| chart.png | image/png | 79 | 79 | identical | PASS |
| diagram unicode café.png | image/png | 74 | 74 | identical | PASS |
| photo.jpg | image/jpeg | 142 | 142 | identical | PASS |
| anim.gif | image/gif | 35 | 35 | identical | PASS |
| large.png | image/png | 244 | 244 | identical | PASS |
| report.pdf | application/pdf | 69 | 69 | identical | PASS |
| notes.txt | text/plain | 42 | 42 | identical | PASS |

**12 media objects served, 12 byte-identical, 7 distinct assets equal 7 source assets, every response HTTP 200 with the correct MIME.** Rendered check: all three images in the multi-image note reported `complete && naturalWidth > 0` with dimensions matching source (16x12, 1x1, 6x6) — the renderer decodes them, it is not showing a placeholder.

### Reconciliation

| Journey set | Source notes | UCT notes | Source media | UCT media | Silent losses |
|---|---|---|---|---|---|
| Notion fidelity (20) | 620 | 620 | — | — | 0 |
| Obsidian fidelity (20) | 200 | 200 | — | — | 0 |
| Evernote media | 9 | 9 | 12 refs / 7 assets | 12 / 7 | 0 |

### Re-import / re-sync integrity

Re-importing the media notebook: **"Will create 0, update 0, unchanged 9"**; images stayed at 9 and attachment chips at 3 — no duplicated media, no repeated paragraphs, no metadata stripping.

### Round-trip exit

`GET /api/j2/notes/export` returned a real ZIP (1,091,412 bytes, PK signature) containing **40 markdown files and 20 media files**, folder structure preserved in the paths. The exported note carries YAML front matter with the original Evernote `created: 2026-01-01T09:00:00Z`, the text interleaved in its source order (one, image, two, image, three), and relative media paths resolving to files bundled in the same archive. A member can take their migrated notebook back out with media intact.

## 18. Closure verdict

| Provider | Min member actions | Unavoidable provider | UCT-created | Final count | Auto initial import | Responsive during conversion | UX verdict |
|---|---|---|---|---|---|---|---|
| Notion | 5 | 2 | 3 (1 primary + consent pair) | **5** | Yes | Yes | CLOSED — 3 needs a consent-model decision |
| Obsidian | 6 | install + paste | 3 (1 primary + consent pair) | **6** (was 7) | Yes | Yes | CLOSED |
| Evernote | 3 | 1 (choose ENEX) | 2 | **3** | Yes | **Yes (fixed)** | CLOSED — at target |

**The frozen-looking migration is gone.** No technical decisions, no conversion configuration, no unnecessary Sync button, no unexplained waiting, no silent failure — and the information inside the migrations is now verified, not assumed.
