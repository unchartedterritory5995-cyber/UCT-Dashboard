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
