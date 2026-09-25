# Notebook — the plan to 10/10 (2026-09-23)

> **What this is.** The remaining work to take the UCT Notebook from where it is today to "complete
> and impressive" against Notion, Evernote and Obsidian, on the owner's six standards plus ten more.
> It is built from two read-only code audits run on 2026-09-23 (every feature checked against the
> code, not by keyword) plus the gap ledger, the close-out record and the gate/live-walk evidence.
>
> **How to read the scores.** Each is an evidence-based estimate, not a measurement against the
> competitors — no head-to-head benchmark or user study has been run yet (Phase 7 does that).
> "10/10" is defined per standard in measurable terms, so it can be checked rather than asserted.
> Current average across the 16 standards: **≈ 6.2 / 10** (the owner's own estimate: 6.8).
>
> **Where this stands in the pipeline.** Branch `feat/g064-ask-notebook-insert` (PR #183) holds
> G-064, the close-out and wave 4 — gated GREEN against a freshly re-adopted master baseline,
> walked live, NOT yet deployed (the push to master needs the owner). Phase 0 starts there.

---

## 1. The scorecard

| # | Standard | Now | 10/10 means (measurable) | The biggest gaps (evidence) |
|---|---|---|---|---|
| 1 | **Features** (breadth vs N/E/O) | 6 | Every feature a Notion/Evernote/Obsidian user reaches for weekly exists, or is a recorded, deliberate "no" with a reason | Editor basics absent: syntax highlighting, math, text colour/highlight, multi-column, drag handles, TOC/outline, word count, replace, emoji, @-mentions, web embeds + link previews; tables are insert-only; callout icon fixed at 💡; images have no caption/alignment. Organization: flat tags, no quick switcher over all notes, no bulk operations, no pages-in-pages, no timeline view, no unlinked mentions, no reminders/tasks view |
| 2 | **Functionality** (depth + correctness of what exists) | 7.5 | Every shipped feature does what it says on every path, with a rail; no dead clicks; no known data-loss path | Offline: F5P-1 (queued words never leave while a member sits on the note), the append-merge finding — a widget, fact or excerpt the server appended can be dropped when an offline edit syncs, 0/18 at unit level, while the member's own text survives in all 42 cases (`wave-q1-f5-append-merge-finding.md`, owner ruling required under the F5 freeze), a 409 during plain typing in the T-12 smoke |
| 3 | **Reliability** | 6.5 | Zero data-loss incidents over a 30-day window with real members; every kill switch and rollback rehearsed; offline gate KEEP on evidence | The latest Wave Q1 gate verdict is **REVERT** (2026-09-20, `C:\Users\Patrick\uct-q1-observe\wave-q1-gate-verdict.md`, out of repo) and has not been acted on; iOS <18.4 crash (fixed) was found only by hand; no restore ever rehearsed |
| 4 | **Speed** | 6 | Budgets set and enforced in CI: note open p95 < 300 ms (1,000 paragraphs), typing < 16 ms/char up to the size cap, search p95 < 100 ms at 50k notes, Notebook JS within a byte budget | No budget exists; 71 ms per character at the size cap (G-035, left open); main entry 1.09 MB + ~0.7 MB Notebook chunks uncompressed; bundle size not tracked |
| 5 | **User experience** | 6.5 | Task-based test with 5–8 traders: every core task completed unaided, SUS ≥ 80; no silent failures | No user testing yet; 0 organic members observed; quick switcher only covers favourites/recents; no bulk operations; dictation missing in the editor |
| 6 | **User interface** | 6.5 | A design review against the three competitors signs off each surface; consistent tokens; no layout regressions at 390/820/1200 | No design review; colour/highlight/callout-picker/drag-handle affordances missing; 24 Notebook components carry no aria (also a UI-semantics gap) |
| 7 | **Data safety & durability** | 7 | Restore rehearsed end-to-end on a schedule; account deletion purges backups; round-trip export verified every release | `auth.db` → R2 every 6 h + nightly (14 kept) and attachments nightly, but **no restore has ever been rehearsed**; deletion does not reach R2 backups; CLAUDE.md's backup sentence is stale |
| 8 | **Security & privacy** | 6 | Vendor data terms verified in writing (zero retention); share-link authorization proven; plaintext index risk reviewed; a security review of Notebook routes | Anthropic/OpenAI terms "UNVERIFIED"; share links built but off (G-080 "authorization unverified"); no E2E; FTS index plaintext in `auth.db` |
| 9 | **Accessibility** | 4 | WCAG 2.2 AA: axe in CI with zero violations on Notebook surfaces, a full screen-reader pass (VoiceOver + NVDA), keyboard-complete (incl. graph) | No audit, no axe tooling, 24 of 58 components with no aria/role, the graph is a canvas with no keyboard movement; `tapFloor` checks declarations, not rendered size |
| 10 | **Mobile, offline & cross-device** | 5.5 | iOS + Android capture parity; cold-start offline; real-device matrix (iOS 16/17/18, Android) green every release | PWA only; iOS share path absent (G-044); no service worker (by charter), so no cold-start offline; device testing is manual (BrowserStack Live) |
| 11 | **Import, export & interoperability** | 7 | Import from every major tool; export markdown/HTML/JSON/PDF/docx; two-way sync where offered; a documented API | Export is markdown zip + single note + PNG/print only; sync connectors read-only (G-093); no public API/webhooks (G-085) |
| 12 | **AI trustworthiness & usefulness** | 7.5 | Grounded, cited, refusing when unsupported (already) + writing help with provenance + semantic retrieval, all on verified vendor terms | No summarize/rewrite/continue/translate; semantic search off (G-127, vendor terms); G-064 insert built but dark |
| 13 | **Search quality** | 7 | Keyword + meaning search, one ranked result list, measured recall on a labelled set, p95 < 100 ms at 50k | No semantic search (paraphrase questions 3/7, G-127); dense terms 166 ms at 50k; non-PDF attachments unsearched |
| 14 | **Performance at scale** | 5.5 | 50k notes, 10k attachments, size-cap notes: all budgets from #4 hold; no super-linear curve | Folder counts, backlinks and search degrade super-linearly at 50k (cause not found, `primary-notebook-readiness-scorecard.md`); 71 ms/char at the cap |
| 15 | **Operability & observability** | 5 | Client + server error reporting on; Notebook telemetry for every core action; canaries in the repo; SLOs with alerts | `SENTRY_DSN` not set, no frontend error reporting; 12 telemetry events (search/Ask/export/import/editor errors untracked); canaries live outside the repo |
| 16 | **Onboarding & learnability** | 5 | A new member reaches a first useful note in < 2 minutes unaided; help centre articles; sample notebook; member templates | First-run screen exists; no Notebook help articles; member-made templates ruled free but not built; 0 organic members to learn from |

**Where the Notebook is already ahead of all three** (keep and extend, never regress): PDF/filing
passages captured as citable, page-anchored objects; Ask answers whose citations are verified
locations and that refuse when the notes don't support them; per-security research assembled
automatically; charts frozen as of insertion; notes linked to trades; thesis-invalidation alerts.

---

## 2. The plan

Each phase is delivered the way this programme already works: spec → plan → implementer → task
review → fix rounds → whole-branch review → six-shard gate against the baseline → live walk →
owner deploy. Waves inside a phase can run in parallel (max three agents on this box).

### Phase 0 — Land and stabilise (now; blocks everything)
1. **Deploy PR #183** (owner push), verify the deploy, re-check the phone Ask-focus fix on
   production (H14), then decide the `NOTEBOOK_ASK_INSERT_ON` flip.
2. **Decide the Wave Q1 REVERT verdict.** It rests on one unattributable sampler row
   (2026-09-13 19:00 ET, "no failing-request URL"); the canary settled 12/12 and every other error
   is attributed to non-Notebook endpoints. Re-run the gate with the attribution fix, then KEEP or
   flip `NOTEBOOK_OFFLINE_DEFAULT_ON=0` — on evidence, and write the decision into the repo.
3. **Close the offline data paths:** F5P-1 (a product ruling, then a fix — its code sits in the
   F5-frozen save path, so it needs the freeze lifted for that one change), the append-merge
   finding (captured widgets/facts/excerpts dropped by an offline sync — also frozen, also an
   owner ruling), and the 409 during plain typing (T-12 step 3).
4. **Turn on error reporting:** set `SENTRY_DSN`, add frontend error reporting, and telemetry for
   search, Ask, export, import and editor errors.
5. **Rehearse a restore** of `auth.db` + attachments from R2 into a sandbox; make it a scheduled
   drill; extend account deletion to the R2 backups (or document the retention window).
6. **Refresh stale records:** gap-ledger rows G-021, G-022, G-030, G-036b, G-043, G-044, G-064,
   G-082, G-083, G-085 and the summary counts; CLAUDE.md's backup and calendar sentences.

### Phase 1 — Editor completeness (the everyday gaps users notice first)
Syntax highlighting (lowlight) · math, inline + block (KaTeX) · text colour + highlight · callout
icon and colour picker · image captions + alignment · table UI (add/delete rows and columns,
header row, resize, sort) · drag handles and block reordering · table of contents / outline ·
word count + reading time · find **and replace** · emoji picker · @date mentions (and reminders,
Phase 2) · web embeds + link bookmarks (server-side oEmbed/OpenGraph with an allowlist) ·
multi-column layout · heading levels H4–H6 · an undo/redo control on touch.
*Bar:* each ships with the paste/drop safety, citation parity (`note_citation_text.py` +
`askCitation.js` tables — the schemaParity rail will demand it), export and share handling.

### Phase 2 — Organization and navigation
Quick switcher over **all** notes (fuzzy, keyboard-first) · bulk operations (multi-select move /
tag / delete / export) · nested tags · unlinked mentions · timeline view · archive state · note
lock (read-only) · split view (desktop, two notes side by side) · reminders with notifications on
date mentions / Review Date · a tasks view across notes · member-made templates (owner already
ruled them free) · a real daily note ("today's note") · a decision on pages-inside-pages vs folders
· lightweight relations between notes (a relation property + backlink), rollups only if measured
demand.

### Phase 3 — Capture and mobile
Publish the browser extension (Chrome Web Store; Edge) · an iOS capture path (owner decision:
native wrapper vs PWA + Shortcuts through the scoped capture-token API) · camera scan with OCR ·
OCR for images and text extraction for docx/xlsx · email-to-notebook (a per-member inbound
address) · dictation in the note editor (reuse `VoiceInputButton`) · cold-start offline (a
service worker — a charter change, owner decision) · a real-device matrix run every release.

### Phase 4 — AI that is useful and still trustworthy
Writing help — summarize, rewrite, continue, translate, autofill properties — every output
labelled with provenance the way G-064 labels an inserted answer · semantic retrieval (G-127) once
vendor terms are verified · G-064's insert on (Phase 0) · AI over attachments beyond PDFs.

### Phase 5 — Sharing and collaboration
Share links on, after authorization is proven (G-080) · publish-to-web for a note or folder ·
comments on shared notes · real-time co-editing and team workspaces **only if the owner reverses
G-081** (it is a large, separate programme; a trader notebook can be 10/10 without it if the
decision is recorded as scope).

### Phase 6 — The quality bars (runs alongside Phases 1–5)
- **Performance:** set and enforce the budgets in the scorecard; fix the super-linear folder
  count / backlinks / search curve at 50k; close G-035 (typing at the size cap); track bundle size
  in CI.
- **Accessibility:** axe in CI on every Notebook surface; aria on the 24 components that have
  none; a keyboard-usable graph (or a list alternative); VoiceOver + NVDA passes; contrast audit.
- **Security & privacy:** vendor data terms in writing; share-link authorization review; a review
  of the plaintext search index; an optional encrypted-note mode if E2E is wanted.
- **Operability:** SLOs (save success, Ask latency, search latency) with alerts; canaries moved
  into the repo; the Wave Q1 observation made a standing dashboard.
- **Onboarding:** Notebook help-centre articles; an interactive first-run tour; a sample notebook;
  the member templates from Phase 2.
- **Interop:** HTML / JSON / docx export; two-way sync where a provider allows it (G-093); a
  documented read API if G-085 is taken up.

### Phase 7 — Prove it
1. **Head-to-head speed benchmark** on one machine with one corpus: open, search, type, paste,
   large note — UCT vs Notion vs Evernote vs Obsidian.
2. **Parity scorecard**: every row of the gap ledger re-scored against the three, evidence per
   row.
3. **Task-based user study** with 5–8 traders (SUS ≥ 80, every core task unaided).
4. **30-day reliability soak** with real members: zero data loss, gates KEEP.
5. **Accessibility audit** by a second reviewer.
Only when every standard meets its bar is the Notebook called 10/10.

---

## 3. Owner decisions this plan needs

1. Deploy PR #183; then the `NOTEBOOK_ASK_INSERT_ON` flip.
2. The Wave Q1 REVERT verdict: keep offline editing on, or flip it off, after the re-run.
3. F5P-1's product ruling, and lifting the F5 freeze for that one change.
4. The rejected rows — multiplayer/comments (G-081), plugin marketplace (G-086), a general web
   clipper (G-043): keep them out of scope (10/10 as *the* trader research notebook) or reverse.
5. iOS: a native wrapper, or PWA + Shortcuts.
6. The no-service-worker charter (cold-start offline).
7. Vendor data terms with Anthropic and OpenAI (unblocks semantic search and AI writing help).
8. G-053 (Ask inside Compass), K-1 (its measured precondition), G-040 (descoped), G-062/G-080
   (legal).
9. Sign-off on the performance budgets.
10. Whether collaboration (Phase 5 beyond share links) is in scope at all.

---

## 4. Suggested order and size

| Order | Phase | Rough size | Why this order |
|---|---|---|---|
| 1 | Phase 0 | 1–2 sessions + owner actions | Nothing else is trustworthy until the deploy lands and the offline verdict is settled |
| 2 | Phase 1 | 3–4 waves | The gaps a Notion/Obsidian user notices in the first five minutes |
| 3 | Phase 6 (perf, a11y, operability) | continuous, 2 waves to set up | Budgets and error reporting must exist before the new features pile on |
| 4 | Phase 2 | 2–3 waves | Navigation and organization at scale |
| 5 | Phase 3 | 2–3 waves + owner decisions | Mobile and capture parity |
| 6 | Phase 4 | 2 waves, after vendor terms | AI usefulness on a verified footing |
| 7 | Phase 5 | 1 wave (share/publish) or a programme (multiplayer) | Scope decision first |
| 8 | Phase 7 | 1–2 sessions + a 30-day soak | The proof |

---

## 5. Evidence this plan was built from
- Code audits, 2026-09-23: editor and organization (every feature with file:line) and capture / AI
  / collaboration / platform plus quality-standard evidence — summarised in the scorecard above.
- `docs/notebook/competitive-gap-ledger.md` (89 rows; stale rows listed in Phase 0 item 6).
- `docs/notebook/RESUME-HERE-2026-09-20.md` (close-out and wave-4 records).
- `docs/notebook/gate-runs/g064-closeout/` (gates and live walks).
- `docs/notebook/q1-product-followups.md` (F5P-1), `wave-q1-f5-append-merge-finding.md`,
  `primary-notebook-readiness-scorecard.md`, and the Wave Q1 gate verdict at
  `C:\Users\Patrick\uct-q1-observe\wave-q1-gate-verdict.md` (outside the repo — it should be
  committed alongside its log).
