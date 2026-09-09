# POST-WAVE-L RE-BASELINE — what still keeps another notebook open

**Date:** 2026-09-08 · after Wave L (Capture Everywhere)
**Method:** current product reality, measured this session, not an old roadmap
replayed. Where I did not verify something, it says so.

> **The question this answers:** *what still forces a serious target member to
> keep Notion, Evernote, Obsidian — or a legal pad — open alongside UCT?*

---

## A. Current UCT Notebook capability map

| Domain | State after Wave L |
|---|---|
| Writing / editor | TipTap WYSIWYG, folders (nested), tags, ticker, hero image, versions |
| Capture — own thought | ✅ palette + hotkey, context-prefilled destination *(reachable only as of Slice 5)* |
| Capture — external source | ✅ in-app, ✅ Chromium extension (unpacked), ✅ Android web share |
| Capture — internal UCT artifact | ✅ 9 widget call sites + tray; Screener/COT/Model Book/OptionsFlow deliberately **not** covered (G-040) |
| Rights / provenance | ✅ structural: link + member-selected passage only; full page refused; source claim vs member annotation separated in storage, retrieval and answers |
| Documents | PDF ingest, page text, excerpts, quote anchors, status lifecycle |
| Search | three sections: Notes (title+body+tags+ticker) · **Documents** (page text) · **Evidence** (excerpts). Source-kind-aware labels + deep navigation as of Wave M. ⚠️ the earlier "not document text" row was WRONG — see C1 |
| Ask | 4 scopes, fenced evidence, typed citations, truthful no-answer, lineage dedupe; note scope now reads captures |
| Thesis / evidence | supports/opposes edges over note · fact · document_excerpt; **no UI path from a captured passage** |
| Financial facts | captured with temporal gate (G-063) |
| Security research workspace | Wave H membership union (ticker field ∪ embed ∪ mention) |
| Migration in | Notion/Obsidian/Evernote/md/docx/html importer + background connectors (Roam, Craft, Notion, Dropbox, OneNote, OneDrive, Substack, Obsidian plugin) |
| Export out | present |
| Mobile | responsive Notebook; share-target capture; **no offline** |
| Sharing out | G-080 implemented, **disabled, unauthorized** |
| Semantic retrieval | benchmarked · architecture selected (C+B) · **DARK** — ~478 MB + 25 s cold load not justified in the single web process |
| OCR | absent |
| Offline | absent |
| Tasks / review loop | absent as a system |

---

## B. Task-gap matrix vs Notion / Evernote / Obsidian

⚠️ Competitor columns are current product knowledge, **not re-tested hands-on
this session**. UCT columns are measured.

| Task | UCT | Gap |
|---|---|---|
| Capture a link/passage from the web | ✅ | **COMPETITIVE** |
| Capture on mobile | ✅ Android; ❌ iOS share sheet | **PARTIAL** |
| Find a captured passage by searching its words | ✅ (Evidence + Documents sections) | **COMPETITIVE** — corrected 2026-09-08 |
| Find text inside a PDF/attachment by searching | ✅ Documents section, navigates to the page | **COMPETITIVE** — corrected 2026-09-08 |
| Scanned document / image text | ❌ | **MATERIAL** (Evernote's historic moat) |
| Work offline | ❌ | **MATERIAL** (Obsidian's moat) |
| Templates / repeatable structure | partial | **MODERATE** |
| Databases / structured views | partial (saved views, properties) | **MODERATE** vs Notion |
| Tasks, reminders, review scheduling | ❌ | **MATERIAL** |
| Collaboration / publishing | ❌ (G-080 dark) | **DEFERRED BY RULING** |
| API / plugins | ❌ | **MODERATE** |
| Editor polish / writing feel | good | **COMPETITIVE** |
| Import my old notebook | ✅ strong | **SUPERIOR** |
| Export my notes back out | ✅ | **COMPETITIVE** |
| Ask questions of my own corpus | ✅ grounded + refuses | **SUPERIOR** |
| File research under a security | ✅ | **SUPERIOR — no competitor has this** |
| Turn a quote into evidence for a position | API only | **MATERIAL (own goal)** |

---

## C. Top remaining switching blockers, ranked

Scored on switching-blocker severity × frequency × UX impact × financial
differentiation × dependency order × trust × mobile × competitive gap ×
acquisition/retention value × engineering risk — **not** by ease.

1. ~~**Search does not reach document/captured text.**~~ ⚠️ **WITHDRAWN
   2026-09-08 — THIS WAS WRONG.** Measured on `notes?q=` and generalised to
   "Search"; the Documents and Evidence sections already reached it. What was
   real was that results could not tell a web capture from a paginated document,
   and said "· p.2" about a Reuters article. Fixed in Wave M.
   **The surviving gap in this area is narrower: low-overlap paraphrase
   retrieval**, which is semantic and remains DARK (`wave-m-closure.md` §3).
2. **No path from a captured passage to thesis evidence.** This is UCT's single
   most differentiating journey and it is currently API-only. Fixing it is
   mostly surfacing work over machinery that already exists and is proven.
3. **OCR / scanned documents.** Filings, screenshots, broker statements and
   scanned research are ordinary inputs for this member. Wave J correctly refused
   to pretend a scanned PDF had text; that honesty now needs capability behind it.
4. **Offline.** Obsidian's trust moat. Export is not offline. A member on a
   plane, a train or a bad connection currently has nothing.
5. **Finance-native review loop.** Nothing else on this list is a *win*; this one
   is. See D.
6. **iOS capture depth.** Web Share Target does not exist there; in-app capture
   is the only door.
7. **Templates / repeatable workflows.** Earnings prep, initiation, weekly review
   are the same shape every time.

---

## D. UCT-specific financial differentiation opportunities

Where UCT stops being "a notebook with stock tags":

- **Passage → evidence → thesis → position**, with stance on the edge and the
  source text never mutated. The pieces exist and are proven; the path does not.
- **"What changed since I bought?"** — position entry date + thesis + captured
  research + new captures is a question no general notebook can even parse.
- **Stale thesis / stale evidence detection.** UCT knows when a claim was
  captured and what it was about; a thesis resting on nine-month-old evidence is
  computable.
- **Earnings prep and post-earnings review** off the member's own captured
  research, not a generic template.
- **Invalidation reminders** tied to the member's own stated invalidation, which
  the thesis model already stores.
- **Ask that knows its own coverage** — already true, and already better than a
  chatbot bolted onto notes.

---

## E. Trust / security / privacy debt

| Item | State |
|---|---|
| G-080 public share links | implemented · **disabled** · **authorization unverified** — keep off |
| GET share payload at Railway's edge | **unverifiable**, documented, narrow-POST mitigation designed not built |
| External embeddings ZDR | unresolved — and the benchmark shows **local** semantic makes it avoidable |
| Sentry DSN | absent today; setting one would open a share-payload channel |
| Encryption at rest beyond platform | not evaluated |
| Extension credential | scoped, revocable, purge-covered, 40 rails |

---

## F. Mobile / offline debt

- No offline read, edit, reconcile, or document access — anywhere.
- No physical-handset certification of the share target.
- iOS has no share-target path.
- Drawing Boards still has no phone surface (carried from the mobile teardown).

---

## G. AI / semantic decision

**Recommendation: local semantic as an ADDITIVE lane, hybrid routed by query
shape — designed next wave, not activated now.**

Measured this session: local `all-MiniLM-L6-v2` lifts recall@5 from 0.345 → 0.512
and MRR 0.50 → 0.71 on the documented Wave K failure class, with **0/3 false
positives** on unanswerable questions, at 91.5 MB, 0.49 s load, ~1.5 KB/passage
and 26 ms/query.

⛔ Three constraints the numbers impose:
1. **It must not replace lexical.** Precision on exact-match questions falls
   0.917 → 0.608. A member typing `NVDA` means `NVDA`.
2. **Naive RRF fusion bought nothing** over semantic alone and still cost lexical
   precision. The hybrid needs routing, not switching on.
3. **Embeddings buy paraphrase, not inference.** Both arms scored zero on "what
   could go wrong". Query expansion or a reranker is the lever there.

**Versus external ZDR semantic:** local wins on the only axis that was blocking —
no member content leaves the box, so the ZDR question disappears rather than
being negotiated. Revisit external only if quality proves insufficient at scale.

---

## H. Next three major waves, in dependency order

### Wave M — **Retrieval & Recall** *(recommended first)*
- **Member problem:** "I captured it and I can't find it." Search misses document
  and captured text; paraphrased questions miss the evidence that answers them.
- **Competitor gap:** Notion and Evernote both search inside attachments.
- **UCT advantage:** the corpus is typed (note · page · excerpt · fact · thesis),
  so retrieval can be precise about *what kind of thing* answered.
- **Dependencies:** none — the FTS tables and the benchmark already exist.
- **Risk:** medium. Touching a certified retriever is exactly what produced (and
  then caught) the Slice 5 Ask defect. Rails first.
- **Impact:** removes blockers #1 and, with OCR later, most of #3.
- **Why now:** it is the highest-frequency failure, it is measured rather than
  assumed, and every later wave is worth more when retrieval works.
- **Why not another:** the review loop (below) is more differentiating but rests
  on being able to *find* the evidence it reasons over.

### Wave N — **Evidence & the finance-native review loop**
- **Member problem:** research does not connect to decisions; nothing tells you a
  thesis has gone stale or that what you bought is no longer what you believed.
- **Competitor gap:** none of the three can do this at all.
- **UCT advantage:** securities, theses, evidence edges, positions, temporal
  truth and captured provenance already exist and are already correct.
- **Dependencies:** Wave M (you must be able to retrieve the evidence), plus
  residual **R2** — surfacing captured passages as attachable excerpts, which is
  the cheapest high-value item on this whole page.
- **Risk:** medium-high — product design risk, not engineering risk. The failure
  mode is building a generic task list.
- **Impact:** this is the wave that makes the old notebook feel generic.

### Wave O — **Document intelligence: OCR + offline foundation**
- **Member problem:** scanned filings and screenshots are invisible; nothing works
  without a connection.
- **Competitor gap:** Evernote (OCR) and Obsidian (offline) each own one half.
- **UCT advantage:** `text_origin` was deliberately shaped for a non-`native`
  value, so OCR lands in the pipeline that already exists rather than beside it.
- **Dependencies:** Wave M (OCR text is worthless if search cannot reach it).
- **Risk:** high — local vs external OCR is a privacy decision, and offline is a
  sync-conflict problem, not a caching problem.
- **Why third:** highest cost, and both halves are worth more after retrieval.

⛔ **Deferred deliberately:** collaboration/publishing (G-080 unauthorized), API
and plugins, canvas, multiplayer.

---

## STOP

This re-baseline is for review. **No wave begins until it has been reviewed.**
