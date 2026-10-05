# Wave 14 evidence pass — the NOT-VERIFIED cells, re-researched

Lane W14-EVID, 2026-10-04. Branch `feat/notebook-w14-evid` (from `origin/feat/notebook-w15-n`,
base `2ac2053fb3`). Docs only: no product code, test or tool touched. This file is the
**proposal**; it follows the format of `docs/notebook/wave15-evidence.md` and the per-vendor
proposal files under `docs/notebook/evidence/scorecard-research/`.

## Scope

`docs/notebook/parity-scorecard.md` §A was parsed at the base. **53 rows** carry at least one
`NOT-VERIFIED` competitor cell (**96 cells**: Notion 23, Evernote 36, Obsidian 37). With the 5 BLOCKED
rows, they make up the 58-row owed list in §C. All 96 cells were re-researched. Wave 15 had already
checked many of the obvious pages today, so this pass went after sources wave 15 did not use:

| vendor | new sources this pass | fetch method |
|---|---|---|
| Notion (N) | the full help sitemap (471 URLs, used to pick pages) and **all 152 official release notes** (`notion.com/releases/*`), grepped | `curl`, HTML stripped (BeautifulSoup). notion.com answered 200, so no WebFetch summary was used |
| Evernote (E) | 18 help-centre articles wave 15 did not read (e.g. Add-a-note-reminder 208314338, Clip-formats 209125827, Wrap-text-around-an-image 51164137580563, Dictation 52683287934355, AI-Edit 41938251046163), plus `evernote.com/{whats-new,release-notes,features,features/tasks,compare-plans}` and `dev.evernote.com/doc/` | Zendesk Help Center API (`help.evernote.com/api/v2/help_center/en-us/articles/<id>.json`), the same door R18's `read_from` records, because Cloudflare blocks WebFetch on `help.evernote.com` |
| Obsidian (O) | **all 494 official changelog entries** (`obsidian.md/changelog/*`, each tagged `public` or `catalyst`), `obsidian.md/privacy`, and a fresh clone of `obsidianmd/obsidian-help` (commit `9cf8c2913e`, 2026-09-29) re-grepped with new terms | `curl` and raw markdown. `[[target\|display]]` wikilinks are rendered to their display text before any quote check |

**Evidence rules applied (the scorecard's own, §"Verdicts"):**
- AHEAD, PARITY or BEHIND needs **both** sides evidenced: a UCT walk at a named tree, never a code reading alone, and a competitor quote from a page fetched on the date it cites.
- An absence on a competitor page is never cited. AHEAD stands only where the competitor's own page states the limit.
- A quote is at most 25 words and verbatim. Every quote below was checked with `grep -F` (or an exact substring test) against the saved text of its page, and the lead lane re-ran the check by hand on every quote that backs a proposed move.
- Only `public`-channel Obsidian changelog entries are used as a basis. Catalyst (early-access) entries are recorded but never relied on.
- All fetches were made on **2026-10-04 local time (US Central)**. In UTC, which is the clock the tool's `fetched_utc` and its rendered dates use, the four pages applied below were saved at **2026-10-05 04:27–04:34 UTC**. The scorecard therefore prints `(2026-10-05)` beside those four quotes. That is the true UTC fetch date, so it was not back-dated to match the local one. The fetched vendor text was saved outside the repo, as wave 15 did:
  `C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\d589caff-6bf7-402f-8cdd-39d4514de50f\scratchpad\w14\pages\{notion,evernote,obsidian}\`.
  It holds 42 Evernote pages, about 190 Notion pages and 13 Obsidian pages, each indexed with its URL and sha256 (`notion/index.jsonl`, `evernote/_index.tsv`).

**Source-type note.** Many of the new quotes come from official **release notes or changelogs**, not
help-centre pages. The scorecard already accepts that kind of source: G-032 and G-138's Evernote
PARITY rests on `evernote.com/release-notes/11.35.6`. A release note dates when something shipped,
though, not that it is still current. The integrator should treat that as the standing caveat for
every changelog quote below.

## What was applied to the scorecard

**First commit (`5046b6b0d`): nothing.** The scorecard is generated:
`python tools/parity_scorecard.py --write --pages <dir>` renders every cell from the tool's own
`QUOTES` and `SOURCES` banks and from its `R()` row entries. It re-checks every quote verbatim
against the archived page texts and computes the counts table, the §C owed list and the Citations
index. At that point the lane's authority was docs only. A hand edit would have been reverted by the
next `--write`, so the five moves were queued.

**Second commit (authority extended by the coordinator): the five cells in §1 are applied, and
nothing else is.** What changed:
- **`tools/parity_scorecard.py`, data only.** 4 new `QUOTES` keys (`O_findinnote`, `O_findreplace`,
  `O_touchundo`, `N_remindnotify`) and 4 new `SOURCES` entries, all `rrow: "R21"`. The Obsidian pages are
  `obsidian__changelog_desktop_v0_5_0_w14`, `obsidian__changelog_desktop_v0_6_0_w14` and
  `obsidian__changelog_mobile_v1_9_10_w14`. The fourth is `notion__reminders_w14`, a re-fetch of the page
  R12 cites under `notion__reminders`; its sha256 differs, so it gets its own `_w14` id rather than
  overwriting R12's.
  - ⚠️ **Applying the cells also took edits to five `R()` row entries** (G-032, G-041, G-138, G-144,
    G-153). Each edit changes the verdict tuple, adds the quote key to the competitor list, and adds
    one note sentence. These are the row data the cells render from. A cell cannot move without them.
    No function, rule or check was changed.
  - **G-041 E needs no new quote.** It moves on its existing R18 quote (`E_clipcomment`, fetched
    2026-10-02 and re-confirmed verbatim 2026-10-04), now that the wave-15 walk evidences the UCT side.
- **`docs/notebook/competitive-research-ledger.md`**: new row **R21**.
- **`--pages`**: a merged directory, 127 files, in this lane's scratchpad (`w14\w14-merged-pages`).
  It is wave 15's `w15-merged-pages` copied unmodified, plus this pass's 4 page texts under their
  page ids.
- **`docs/notebook/parity-scorecard.md`**: regenerated by `--write`. Besides the five cells, the
  counts table and the §C owed list, one more thing moved, mechanically: every
  `RECORD docs/feature_flags.json at <rev>` now names the revision `--write` read the flag ledger at
  (`5046b6b0d`, this branch's previous tip). That is the same mechanism wave 15's write followed.

Checks on the second commit's tree (output verbatim):

```
python tools/parity_scorecard.py --write --pages <w14-merged-pages>
  wrote docs/notebook/parity-scorecard.md 420921 chars: {'rows': 133, 'quote_keys_used': 173, 'at_bar': 3,
  'clauses': {1: '0/3', 2: '4/4', 3: '2/3', 4: '5/6', 5: '1/4', 6: '3/3', 7: '2/3', 8: '3/4', 9: '3/4',
  10: '0/3', 11: '3/4', 12: '2/4', 13: '3/4', 14: '3/4', 15: '4/4', 16: '3/4'}, 'quotes_verbatim_checked': True}
python tools/parity_scorecard.py --verify --rev HEAD
  checked against HEAD: CODE 150, FLAG 11, MEASURE 35, RECORD 108, RULING 18, TEST 36, WALK 67
  VERIFY: PASS
python tools/check_repo_hygiene.py
  clean: 22480 tracked file(s), no oversized file, no .env* outside the allowlist, and no line-ending flip against the stored blobs
python -m pytest tests/test_parity_scorecard.py tests/test_parity_scorecard_evernote_fold.py -q
  52 passed, 2609 warnings in 362.91s (0:06:02)
```

§A verdict counts after the write (NOT-VERIFIED N 23→22, E 36→35, O 37→34; PARITY N 58→59, E 47→48,
O 45→48). Every other row of the table is unchanged; the §B clause breakdown is identical before and after.

## Controller rulings owed

The 12 cells from §2 below. **None is applied.** Each needs a ruling before an integrator moves it.
"Recommended" is this lane's reading, not a decision.

| row | col | recommended verdict | one-line reason |
|---|---|---|---|
| G-153 | E | PARITY | Evernote's per-note reminder notifies on its date; the row names "on date mentions / Review Date", which Evernote does not tie it to. Rule whether the trigger is part of the capability. |
| G-123 | N | PARITY | Notion's release note says a citation locates "the specific block being cited", a location inside the source. The UCT side is CODE+TEST, not a walk; G-124/G-125 already accept that tier. |
| G-003 | O | PARITY | The privacy page says account deletion is permanent and Sync/Publish data is deleted on cancel. That is as modest as the reading Notion's PARITY already rests on. Local vault files are untouched by design. |
| G-158 | O | NOT-VERIFIED | A link-valued property showing in backlinks is not a typed relation property. The quote covers the backlink half only. |
| G-169 | O | PARITY | "You can now export notes to PDF." is the same PDF-only reading Evernote's PARITY on this row rests on, so consistency argues for it. |
| G-045 | O | AHEAD | "Obsidian only searches the contents of notes and canvases." states that a scanned PDF's text is outside its search. This is the G-113 stated-limit pattern. |
| G-121 | O | AHEAD | Same quote and same reasoning as G-045, applied to OCR. |
| G-160 | O | AHEAD | Same quote: image text and docx/xlsx text are outside Obsidian's stated search scope. |
| G-133 | E | NOT-VERIFIED | Wrap-left/right is text wrapping, not alignment, and names no centre option, which UCT's B26 checked. |
| G-110 | E | PARITY | Tabs are "restored exactly as you left them" after reopening, a resumption surface as modest as the Obsidian recents list this row already accepts. It is desktop only. |
| G-141 | E | NOT-VERIFIED | The Bookmark clip makes a new note from a page; it is not a link preview or embed inside a note. |
| G-085 | E | NOT-VERIFIED | The general API is "deprecated", not gone, and the live door is an MCP server for AI clients, a different mechanism. The existing "different mechanisms" note still applies. |

The G-041 N note (a possible AHEAD read from the web-clipper page's tags limit) is **not** a
ruling owed. It would be an inference from absence, which the rules forbid; it is recorded in §2
for the owner only.

## Clause-status (§B) changes

**None proposed, none flagged.** Every §B clause is a statement about UCT, such as "every weekly
feature exists for members". None reads a competitor verdict, so a competitor cell moving from
NOT-VERIFIED to PARITY cannot change a clause from MET to NOT MET or back. The headline stays
**3 of 16 standards at bar**.

---

## 1. Settled by evidence alone (5 cells, both sides evidenced; APPLIED in the second commit)

Each of these has a UCT-side WALK already on the row, and a competitor page fetched 2026-10-04
that states the capability as the row names it. No judgment beyond the scorecard's rules is involved.

| row | col | before → proposed | quote (verbatim, ≤25 words) | source (fetched 2026-10-04) | UCT walk already on the row |
|---|---|---|---|---|---|
| G-032 Find-in-note | O | NOT-VERIFIED → **PARITY** | "Ctrl+F to open the search, and use F3 to jump to next match, or Shift+F3 to the previous match." | https://obsidian.md/changelog/2020-05-10-desktop-v0.5.0/ (public), sha256 `9a7e5298332a621f39d62cdd55438980e4d29c5591ca6c6b8fee7e2216bbabb9` | `browser_check_9b.py`:B20 PASS (Ctrl+F opened the find bar) |
| G-138 Find and replace | O | NOT-VERIFIED → **PARITY** | "You can now now search AND replace, Ctrl+H by default." (the doubled "now" is Obsidian's) | https://obsidian.md/changelog/2020-05-18-desktop-v0.6.0/ (public), sha256 `63adc46f73a2ec6d1f56829f63e4a1cfed1df04b52661677f9472c242805c021`. A later corroborating entry, https://obsidian.md/changelog/2020-12-16-desktop-v0.10.1/, says "Search and replace now has a new default hotkey on macOS Cmd+Option+F…" | `browser_check_9b.py`:B05 PASS (Replace all) |
| G-144 Undo/redo control on touch | O | NOT-VERIFIED → **PARITY** | "The default toolbar now shows undo and redo at the start of the row." | https://obsidian.md/changelog/2025-08-18-mobile-v1.9.10/ (public, **mobile**), sha256 `550460c90dace91d6570ee20df6d5a264a80334aa8faed7433309624c2338fbf` | `notebook_wave10b_walk.py`:B1_touch_undo_redo PASS, B10 PASS |
| G-041 Comment field at capture time | E | NOT-VERIFIED → **PARITY** | "If you want to organize your clip into a different notebook, add a tag, or add a comment, you can do that easily right before you clip!" (the existing cited quote is its tail; re-confirmed) | https://help.evernote.com/hc/en-us/articles/209125877-Evernote-Web-Clipper-Quick-Start-Guide, sha256 `895cd300b71182b732c222308bfd3d79224cb6d34d1d7f4f0c708fec6ab238af`. Corroboration: Clip-formats (209125827) "Remark : Add additional comments or notes that will help you remember what you've clipped." | `notebook_w15_uct_walk.py`:G041_capture_desktop_1200 PASS, G041_capture_mobile_390 PASS (tip 674012eb1) |
| G-153 Reminders with notifications | N | NOT-VERIFIED → **PARITY** | "When you add a reminder, Notion will send you a notification to draw your attention back to a particular task" | https://www.notion.com/help/reminders, sha256 `124965b97ad67aa19e480ee46bb28d98de6a986ce3bf187c6320dbe57996105f` (the existing quote "Notion can help remind you…" is still verbatim on it). The same page says "You can create reminders in a database if the database has a Date property." — a date-driven reminder, as the row names it | `notebook_w15_uct_walk.py`:G153_reminder_delivered_server PASS, G153_reminder_bell_mobile_390 PASS |

Why G-041 E and G-153 N had not moved yet: wave 15's integrator added the UCT walk citations to both
rows. Its doc says it made **no verdict call**, because that was not its brief. The competitor
quote was already on G-041 E, and both sides are now evidenced.

## 2. Flagged for a controller ruling (a quote exists; whether it settles the row is a judgment)

| row | col | candidate | quote (verbatim) | source (2026-10-04) | the judgment the controller must make |
|---|---|---|---|---|---|
| G-153 Reminders on date mentions / Review Date | E | PARITY | "You can opt to receive email alerts on the day timed reminders are due." | https://help.evernote.com/hc/en-us/articles/208314338-Add-a-note-reminder, sha256 `92e0d0d0b3910b2f8dcea69d038838dcdeb9142997a885732d487281e3e98535` | Evernote's reminder is **per note**, not driven by a date mention or Review Date. Is that PARITY on "reminders with notifications" as named? Notion's reminder (§1) is date-driven, so it does not have this gap. |
| G-123 Citation that is a verified location | N | PARITY | "Click on citations to locate and easily review the specific block being cited" | https://www.notion.com/releases/2024-06-18, sha256 `e19087655a2a4b8e8f783e2210415f513f6e289eebb472ade499f58edeb0a722` | This answers the row note's "Notion's is page-level": Notion's citation reaches a block. **But the UCT side is CODE + TEST (`askCitation.parity.test.js`), not a walk.** The rule names a walk; G-124 and G-125's Notion PARITY already rest on the TEST tier. Should that tier stand here too? Notion never says "verified", so the candidate is PARITY, never AHEAD. |
| G-003 Account-deletion purge | O | PARITY | "You may choose to delete your Obsidian account at any time using the account dashboard, which will permanently delete your account, licenses, and subscriptions." (24 words) and "If you cancel the subscription yourself, your data is deleted immediately." | https://obsidian.md/privacy, sha256 `a91584c660c7fbc07d8ed9c35de5fd936b4a1c804a9b773b3168da02b44a59fd` | Obsidian's vault is local files, which no account deletion touches. The purge covers only what Obsidian's servers hold (Sync, Publish). That reading is as modest as the one Notion's PARITY already rests on. |
| G-158 Relation property + backlink | O | PARITY | "Backlinks: Properties with links will now properly show in backlink entries." | https://obsidian.md/changelog/2023-08-31-desktop-v1.4.5/ (public), sha256 `e49306f5bf033cd0a8ca93b738903cb8a6275a453f088940c2f80b40c4fcda57` | Together with the existing Properties quote, this states the backlink half. It **reverses** the row's current note ("does not describe a relation with a backlink"). A link-valued property is not a typed "relation" property. |
| G-169 Export to HTML/JSON/Word (and PDF) | O | PARITY | "You can now export notes to PDF." | https://obsidian.md/changelog/2020-11-03-desktop-v0.9.11/ (public), sha256 `11aa282e49219e47a5b5ba08769bbe62098a5be69736442edcf6e7e72b114f57` | PDF only. Evernote's PARITY on this row already rests on a PDF-only quote, so consistency argues for PARITY. The row names HTML, JSON and Word first. |
| G-045 PDF upload + OCR · G-121 OCR · G-160 image OCR / docx-xlsx text | O | **AHEAD** | "Obsidian only searches the contents of notes and canvases." (existing key `O_searchlimit`, R18 source) | https://help.obsidian.md/plugins/search, re-confirmed verbatim 2026-10-04 | This is the stated-limit pattern behind G-113's O AHEAD and Notion's G-045/G-121 AHEAD. Applying it to three more rows extends a controller ruling, so it is **not** applied on evidence alone. The UCT side is a walk on all three (W14; 12D S2/S3; L1a B3). |
| G-133 Image captions and alignment | E | PARITY | "select a text wrapping option (for example, Wrap text left or Wrap text right )" (the trailing space before ")" is Evernote's) | https://help.evernote.com/hc/en-us/articles/51164137580563-Wrap-text-around-an-image-in-a-note, sha256 `29a25417b39461d0c88be58e641b3d1035a759030a9c57330eefb77cf9e360a2` | Captions are already quoted. Does wrap-left/right count as "alignment"? The page names no centre option, and UCT's B26 checked centre. |
| G-110 "Where was I working?" | E | PARITY | "When you close and reopen the app, your tabs will be restored exactly as you left them." | https://help.evernote.com/hc/en-us/articles/52440426461075-Use-tabs-to-multitask-in-Evernote, sha256 `489c1815b5af993e2923ca16201615f5e0e3b75808418982d6993be35cec984e` | Session restore of tabs, desktop only. Is that a resumption surface in the same modest sense the row accepted for Obsidian's recents list? |
| G-141 Web embeds and link bookmarks | E | (lean: stays NV) | "Save the URL, an auto-generated thumbnail from the page, and a snippet of text." | https://help.evernote.com/hc/en-us/articles/209125827-Clip-formats, sha256 `db855ebebfa3e8647284c3d3c8cff19b0327e23032576947720b9b8d84df7c25` | This is the Web Clipper's Bookmark clip type, a note made from a page, not an in-note preview block. |
| G-085 Public API / webhooks | E | (no verdict proposed) | "The classic Evernote Developer API (EDAM) and its SDKs are deprecated and no longer actively developed." | https://dev.evernote.com/doc/, sha256 `1083c2ef832bb122f7169be7c8915d6b28d8ea05b596e95ac8343523f6e2fa26` | The page states deprecation, not unavailability: the API "remain[s] available" for existing integrations. The live door is the MCP server. The existing "different mechanisms" note still applies. |
| G-041 Comment field at capture time | N | (AHEAD **not** proposed) | "Can you add tags to a web page while clipping it? Not at the moment, unfortunately." and "Go to the page you chose to see your clipping, comment on it, add properties, etc.!" | https://www.notion.com/help/web-clipper, sha256 `50c34467c6a4d07f241a72d8f069bc6fcb386e6cf13ab04c288dfb6e47f4384c` | The page states a limit on **tags** at clip time and puts commenting after the save. It never states that a comment cannot be added at clip time, so AHEAD would be an inference. Recorded for the owner. |

## 3. Competitor side now evidenced; the row waits on the UCT side

For these rows a quote was found, or an existing one re-confirmed, on 2026-10-04. The verdict stays
**NOT-VERIFIED** because the UCT behaviour has never been observed. Once the named UCT evidence
exists, each quote gives PARITY with no further fetch.

| row | col(s) | quote (verbatim) | source | UCT blocker (unchanged) |
|---|---|---|---|---|
| G-044 / G-084 mobile share-sheet | N | "Our mobile Web Clipper uses native share sheet functionality on both iOS and Android." | https://www.notion.com/help/web-clipper | owner: an iOS Shortcut run on an iPhone |
| G-044 / G-084 | O (stronger than the cited quote) | "Obsidian's Share Sheet lets you capture content from web pages." | https://help.obsidian.md/ios, sha256 `ec0fb69fa70fbaaac2bc449a9692e9859462915b93161b2aa81a278b2f3dbcc2` | same |
| G-044 / G-084 | E | "the share extension built into iOS and Android allows you to save content from your mobile device." | https://help.evernote.com/hc/en-us/articles/208313678-Save-clipped-content-on-iOS-and-Android-devices | same |
| G-166 AI over attachments beyond PDFs | N | "Ingest files like PDFs and CSVs and answer questions about them, or turn them into structured pages or databases." | https://www.notion.com/help/notion-agent, sha256 `ce1fb81038158b5c0b20a77f7b981776a09956ed6e5cc34fbc2b88b6268760a5` | a browser pass with a model key |
| G-159 camera scan + OCR | E | "Handwritten or printed text saved to Evernote becomes searchable." | https://help.evernote.com/hc/en-us/articles/222177927-Capture-handwriting-and-scan-documents-with-your-phone | a real-device scan, then search its words |
| G-162 dictation | E | "Dictation lets you dictate directly into a note and have your speech converted to text in real time." | https://help.evernote.com/hc/en-us/articles/52683287934355 (Dictation) | a browser pass with a model key |
| G-165 writing help | E | "Choose an action from the primary menu: Summarize , Paraphrase , Fix typos , Help me write , Translate , or Write as ." | https://help.evernote.com/hc/en-us/articles/41938251046163 (AI Edit) | a browser pass with a model key (B7 INCONCLUSIVE) |
| G-050, G-051, G-165 | N | the existing quotes were re-fetched and are still verbatim (notion-ai-faqs, research-mode, enterprise-search, autofill) | as cited in §A | a browser pass with a model key |

## 4. Still NOT-VERIFIED, with the reason

| row | col(s) | reason |
|---|---|---|
| G-011, G-035 | N E O | **By rule:** competitor speed is lane 9A's protocol and the owner's run, and is never stated in this file. Not researched. |
| G-005 | N E | Neither page states crash or close protection. The UCT side is also a code reading only (`NoteEditorPage.jsx`:226 `DRAFT_KEY`, a per-keystroke localStorage mirror at :1556 and a restore read at :1206). No walk has driven a restore, so the UCT side cannot support a verdict either way. Notion was checked and does not match: "Any changes you make offline will save locally and sync automatically…" describes offline sync. |
| G-014 | N | Notion's 2023-12-20 release note says "pages have previews". That is not stated to be a query-aware, highlighted snippet. |
| G-015 | E | No page states a relevance sort for ordinary results. The semantic "Quick answer" is a different surface. |
| G-021 | E | 11.36.4 adds sort/filter to in-note **table blocks**, not note-level properties or views. |
| G-031, G-102 | E | Keyboard shortcuts and the slash menu are documented; no command palette is. G-102 is a UCT-internal row. Wave 15's open question about putting N/A in this cell is still the controller's. |
| G-113 | N E | Neither page states page-aware sectioning. Evernote's scanned-PDF page states PDF search only. |
| G-122, G-123, G-124, G-125 | O | No official Obsidian page describes a built-in assistant, so there is nothing to scope, cite, refuse or guard. Absence is not cited. |
| G-123 | E | "Replies include which notes were used…" is note-level. |
| G-124 | E | It still waits on the existing ruling: is "may suggest using its built-in knowledge or searching the web" a refusal? |
| G-125 | E | The AI Assistant, AI FAQ and AI Prompts pages say nothing about prompt injection. |
| G-129 | E | Code blocks exist ("Tables, code blocks, and quotes"); no page states per-language highlighting. |
| G-131 | O | 1.14.0's "Added color highlights." is **catalyst only**, and it is a highlight colour, not text colour. Revisit when 1.14 ships public, and only for the highlight half. |
| G-133 | O | No page states image captions or image alignment. |
| G-139, G-140 | O | No emoji picker and no @date mention on any official page. |
| G-142 | E O | No multi-column note layout. The Bases kanban "columns" (catalyst) are a view. |
| G-145 | E | The shortcut page lists "Switch to... ⌘ + J Ctrl + Q". Calling it a fuzzy switcher over all notes is inference. |
| G-147, G-148 | N | No page states nested tags or unlinked mentions. |
| G-148 | E | "quickly navigate from one to another using backlinks" covers linked backlinks only. |
| G-149, G-150 | E O | No timeline view and no archive **state**. Obsidian 1.14.4 mentions an "Archive" folder, which is a name, not a state. |
| G-151 | O | Checked and not a match: Canvas readonly mode ("While in readonly mode, a canvas and its contents cannot be modified.", 1.1 public). A canvas is not a note. |
| G-152 | N E | Notion's Side peek ruling (2026-10-04) stands, and its desktop tabs page names no split. Evernote's tabs are browser-style, one visible at a time. |
| G-153 | O | No reminders or notifications on any official page. |
| G-154 | O | `task:` search operators are not a tasks view (unchanged from wave 15). |
| G-158 | E | Note links and backlinks exist; there is no relation property. |
| G-159 | N O | No document scan with OCR. Notion's widget camera feeds AI chat. The UCT side has also never run on a device. |
| G-160 | N | No page states searchable image or docx/xlsx text. Research mode names PDFs only. |
| G-161 | N O | Notion Mail is an email client, not an inbound address. Obsidian has none. |
| G-162 | N O | Notion's "Voice input for Notion AI…" is voice into the AI chat, not dictation in the editor. Obsidian has only OS voice-input bug fixes. The UCT side needs a model key. |
| G-165, G-050, G-051, G-166 | O | No built-in Obsidian AI is stated. The UCT side needs a model key. |
| G-085 | O | URI and CLI are local mechanisms, not a member-callable web API (unchanged). |
| G-167 | E | Single-note share links exist; notebook publishing is team-internal (unchanged). |
| G-168 | N E O | No conformance statement. Notion's 2021-10-19 note covers colour contrast only. `obsidian.md/accessibility` is a 404, and Evernote has no page. The UCT side still waits on the owner's screen-reader passes. |
| G-171 | E | The Quick Start is an article, not an in-app tour. No sample notebook is stated. |

## 5. UCT-column check (rows whose UCT side is a code reading)

Each fragment was read at this branch's HEAD (`2ac2053fb3`). `--verify` PASS covers all 150 CODE
citations. Under the scorecard's rule a code reading **supports** a claim but never confirms
behaviour, so none of these rows can take a comparative verdict until it is walked.

| row | file:line on this branch | supports | confirmed? |
|---|---|---|---|
| G-005 | `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx`:226 (`DRAFT_KEY`), :1556 (mirror on every edit), :1206 (restore read) | a local draft written on every keystroke | **unsupported as behaviour**: no walk |
| G-050 | `api/services/note_ask.py`:13 | Ask Current Note's prompt boundary | no model key, no answer observed |
| G-051 | `api/services/journal_two/ask_service.py`:9 | one Ask pipeline across scopes | no model key |
| G-123 | `app/src/pages/journal-2-0/lib/askCitation.js`:35 (`VALID_EXACT`), :37 (`VALID_NOTE_ONLY`) | a citation re-checked against the text at [from,to] | TEST tier only (see §2) |
| G-124 | `api/services/journal_two/ask_service.py`:15-16 "NO ANSWER MEANS NO MODEL CALL… never contacts the provider" | refusal without a model call | TEST tier only |
| G-125 | `api/services/journal_two/ask_prompt.py`:3 "RETRIEVED CONTENT IS DATA, NEVER INSTRUCTION.", :167 | fenced retrieved text | TEST tier only |
| G-162 | `app/src/pages/journal-2-0/lib/dictationInsert.js`:2 | dictation inserted at the caret | no model key |
| G-165 | `api/services/journal_two/writing_help.py`:48 | the four writing-help actions | no model key |
| G-166 | `api/services/journal_two/ask_retrieval.py`:456 | document pages in Ask retrieval | no model key |

## Tally

- **96 NOT-VERIFIED cells researched** (53 rows).
- **5 cells settled by evidence alone**, queued for a tool-authorised integrator: G-032 O, G-138 O, G-144 O, G-041 E, G-153 N.
- **12 cells flagged for a controller ruling**: G-153 E, G-123 N, G-003 O, G-158 O, G-169 O, G-045 O, G-121 O, G-160 O, G-133 E, G-110 E, G-141 E, G-085 E. The G-041 N AHEAD-by-inference note is recorded but not counted as a candidate.
- **9 cells with the competitor side now evidenced** but blocked on the UCT side: G-044 and G-084 in N, E and O; G-166 N; G-159 E; G-162 E; G-165 E (G-050, G-051 and G-165 N re-confirmed).
- All other cells **stay NOT-VERIFIED** for the reasons in §4.
- **Scorecard cells moved: 5** in the second commit (G-032 O, G-138 O, G-144 O, G-041 E, G-153 N), regenerated by `--write`; 0 in the first.
- **§B clause-status changes: 0 proposed, 0 flagged.**
