# WAVE L — CAPTURE EVERYWHERE · Entry Checkpoint

**Date:** 2026-09-07 · Resolved **BEFORE** any source mutation, per directive §184.
**Objective:** *"I found something useful anywhere — desktop or mobile — and I can
get it into the correct UCT research context in seconds, with provenance intact."*

⭐ **The competitor task matrix is in this checkpoint, not in the closure record.**
Wave K skipped it at entry and paid for it at closure; the mini-pass made it an
entry **gate item**. §5 below.

---

## 1. What already exists — read, not assumed

| System | Reality |
|---|---|
| `j2_capture_inbox` | Stages a **widgetEmbed** (`widget_id`, `params_json`, `search_text`, `fallback_url`, `annotations_json`, `captured_at`, `caption`, `trade_ref`). 256KB ceiling. Built for UCT's own widgets. |
| `j2_note_documents` | `attachment_url` NOT NULL, note-owned, `status` lifecycle (`pending`/`ready`/`processing_failed`/`no_text`), `UNIQUE(note_id, attachment_url)` |
| `j2_note_document_pages` | `(document_id, page_number, text, text_origin)`. **`text_origin` was deliberately pre-shaped for non-`native` values** — that is how Wave J was to add `'ocr'` "rather than building a parallel one". FTS mirror is trigger-driven. |
| `j2_note_excerpts` | Requires `document_id` + `page_number`; carries `captured_text`, `quote_prefix/suffix`, `char_start/end`, `annotation` |
| `thesis_evidence.TARGET_TYPES` | **`("note", "fact", "document_excerpt")`** — `target_type` deliberately left an open string so Wave J could extend it |
| `ask_evidence.SOURCE_TYPES` | `note` · `document_page` · `document_excerpt` · `financial_fact` · `thesis_state` |
| Ticker membership | Wave H's union in `_notes_filter_sql` — ticker field OR embed OR mention. **One membership system already exists.** |
| Capture doors today | 9 widget call sites + `CaptureInboxTray`; **not** reachable from Screener, Options Flow, COT, Model Book |
| CORS | `allow_origins=["*"]` app-wide; session is a cookie |

---

## 2. THE decision: a captured web source is a DOCUMENT

**Not a new object type, and not a widget embed.**

The constraint that settles it is workflow 2 (selected passage → thesis evidence):
`thesis_evidence` accepts only `note`, `fact`, `document_excerpt`. A widget embed
can never be attached as thesis evidence; a **document excerpt** already can.

So:

| Captured thing | Modeled as | Inherits, unchanged |
|---|---|---|
| The source (article/page) | a row in `j2_note_documents`, `text_origin='web'` on its pages | status lifecycle · purge cascades · tenant scoping |
| Its text | `j2_note_document_pages` | **FTS indexing via existing triggers** — no app-side indexing call to forget |
| A member-selected passage | `j2_note_excerpts` | quote anchors + re-location · the `documentExcerpt` node · page-anchored citation UI |
| Attaching it to a thesis | existing `document_excerpt` target type | stance on the EDGE, not the excerpt |
| Ask finding it | `document_page` / `document_excerpt` | already in `SOURCE_TYPES` · **Wave K lineage dedupe** (page + excerpt + thesis edge = ONE source) |
| Appearing in NVDA Research | the Wave H membership union | **no second membership system** (§5 of the directive) |

⭐ **This is the whole reuse case: one decision inherits search, evidence,
citation, Ask retrieval, dedupe, isolation and purge.** Building a `weblink`
widget type instead would inherit the capture tray and the note body — and would
be a dead end at thesis evidence, at Ask, and at excerpts.

**What must be extended, minimally:** `attachment_url` is NOT NULL and carries a
filesystem-path-is-identity meaning for PDFs. A web source has a URL, not an
attachment. This needs a `source_url` / `source_kind` distinction rather than
overloading `attachment_url` — deciding that is slice 1's first task, and it is
the one schema question this wave should be careful about.

---

## 3. ⛔ The rights boundary, and where Wave L STOPS

Directive §6 separates four things. They are genuinely different, and UCT's
existing architecture already draws the same line:

| Tier | Wave L | Why |
|---|---|---|
| **Link + metadata** (title, URL, domain, captured_at) | **SHIP** | A citation, not a copy. No rights question. |
| **Member-selected passage** | **SHIP** | The member's own act of quoting — byte-for-byte the same object they already store from a PDF (`j2_note_excerpts`). Wave J settled this shape. |
| **Full-page cleaned content** stored permanently | **STOP** | This is Phase Zero §21's shape: permanent storage of third-party content. Requires the owner's rights ruling. |
| **Rendered snapshot** (screenshot of a page) | **STOP** | Same boundary, plus it is a redistribution vector if a note is ever shared (G-080). |

⭐ **This is a better product answer, not merely a safer one.** A document whose
pages carry the member's selected passages plus metadata delivers *every*
workflow the directive names — search, excerpts, thesis evidence, Ask, NVDA
Research membership — **without storing a copy of someone else's article.** The
member's judgment about which passage matters is the durable research artifact;
the full page is raw material they can always re-open at the source URL.

**If the owner later clears full-page storage, it lands in the SAME tables** as
additional page rows. Nothing gets rebuilt.

---

## 4. Entry point: what to build, on evidence

| Candidate | Verdict |
|---|---|
| **Browser extension** | The only door that works where the member actually reads. Cookie auth + `allow_origins=["*"]` means an extension can call the API as the logged-in member with no new auth system. **Primary desktop door.** |
| **In-app quick capture** (command palette + global hotkey) | The palette already exists and already carries Notebook commands. Cheapest real win; also the door for "a thought", not a page. **Ship.** |
| **The 4 uncovered internal surfaces** | Screener, Options Flow, COT, Model Book — the mechanism exists at 9 sites. **Ship.** ⚠️ OptionsFlow.jsx is partner-owned: className hooks only, no inline-style edits. |
| **Mobile share-sheet** | Requires the PWA to be a real installable target. **Ship the manifest + a capture route that accepts the Web Share Target payload.** |
| **Bookmarklet** | Only if the extension is blocked for a browser we care about. Not scheduled. |

---

## 5. Competitor task matrix (the entry gate item)

Current-sourced 2026-09-07.

| Task | Evernote | Notion | Obsidian | UCT after Wave L |
|---|---|---|---|---|
| Discover the capture door | Extension button, all major browsers | Extension button | Extension button, Chrome/Edge/Firefox/Safari | Extension button **+ palette + in-app doors** |
| Steps: page → saved | 2–3 (clip type, notebook, save) | 2–3 | 2–3 (template auto-applies by site) | **Target ≤3, destination pre-filled from ticker context** |
| Select-text capture | Yes (selection clip) | Yes | **Yes, with persistent highlights** | Yes — and the passage is a first-class excerpt |
| Destination obvious | Notebook picker | Database picker | Vault/folder + template | **Ticker research / note / inbox** |
| Provenance | Source URL kept | Source URL kept | URL + metadata + Schema.org into properties | URL + domain + captured_at, **and source material never becomes member belief** |
| Find it later | Note search | Workspace search | Vault search | Notes **+ Documents + Evidence** sections, already three-way separated |
| **Mobile capture** | Full mobile app | Full mobile app | ⛔ **Requires Obsidian installed and RUNNING locally — clipping is limited where the app is absent** | **Web Share Target — server-side, no local app, available on every device instantly** |
| Financial context | None | None | None | **Lands in the security's research workspace; attachable as thesis evidence** |

⭐ **The two places UCT can genuinely win, not match:** Obsidian's clipper cannot
capture where the app is not installed — UCT's destination is server-side, so a
phone capture is on the desktop before the member sits down. And *no competitor
has a security to file it under.*

---

## 6. Source trust — Wave K's invariant extends unchanged

**RETRIEVED CONTENT IS DATA, NEVER INSTRUCTION**, now with a second untrusted
producer. Captured page title, metadata, body text, hidden DOM and scripts are
untrusted. Concretely: no captured content reaches `system=` (Wave K's
`system_prompt()` already takes no arguments); captured text enters Ask only as
fenced, marker-counted evidence like any other `document_page`; nothing captured
is ever rendered as HTML — text only, no active content, no remote subresources.

---

## 7. Slices

0. **Rights/provenance + trust rails first** (the Wave K idiom): what may be
   stored, what may not, and the injection boundary for a second untrusted source.
1. **The capture contract** — `source_kind`/`source_url` on documents, the
   web-source + page + excerpt write path, membership via the Wave H union.
2. **In-app quick capture** — palette + hotkey + the 4 uncovered surfaces.
3. **The browser extension** — the door where the member reads.
4. **Mobile** — Web Share Target, real manifest, phone-width certification.
5. **E2E + competitor re-run + closure.**

**Rider:** note-level keyboard shortcuts (the genuine remainder of old G-102).

**Parallel, measurement only:** the semantic benchmark for Wave M — deterministic
vs local vs hybrid, on the known low-overlap failure class. **No activation, no
Notebook content to any external embedding endpoint.**

---

## 8. Non-goals, restated

Offline · semantic activation · collaboration · publishing · G-080 activation ·
full task/reminder system · OCR · public API · encryption redesign · Wave M
implementation. **PWA work is scoped to what capture and resume need** — it does
not become the offline wave.
