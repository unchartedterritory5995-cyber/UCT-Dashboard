# WAVE M — RETRIEVAL TRUTH & NAVIGATION · closure

**Date:** 2026-09-08 · **Branch:** `notebook-primary-platform`
**Commits:** `6cac94274` (result truth) · `178469ae3` (navigation depth)

---

## 0. ⚠️ STATUS CORRECTION — the wave's original premise was false

This is recorded, not erased, because the mistake is mine and the correction is
the useful part.

| | |
|---|---|
| **EARLIER CONCLUSION** (Wave L closure, and the original Wave M directive) | "Notebook Search does not reach captured/document text. Ask can find it, Search cannot." |
| **CORRECTION** | **The corpus was already reachable.** That statement was measured on `GET /api/j2/notes?q=` — whose FTS index is title + body_plain *by design* — and generalised to "Search". The member's Search has rendered **three sections since Waves I and J**: Notes, Documents, Evidence. |
| **EVIDENCE** | A passage captured from Reuters, queried on the running product: `notes=0 · documents=1 · excerpts=1`. `FolderSidebar` calls `useDocumentSearch` and `useExcerptSearch` in search mode and renders both sections. |
| **ACTUAL DEFECT** | Search could not **distinguish** an external web-passage row from a real paginated document row, because `source_kind` was never selected into the result surface — producing false `p.N` labels. |

⭐ **The lesson, for the retrieval doctrine:** *a search system can retrieve the
correct row and still be wrong.* Retrieval correctness includes object identity,
source kind, provenance, coverage, label and navigation. **A false label is not
cosmetic when it changes the implied epistemic meaning of the source.**

---

## 1. Result truth — DONE

A captured web source is a `j2_note_documents` row whose passages are page rows,
and `page_number` there is a **capture ordinal**. Both search sections rendered
it as `· p.N`, so a second passage clipped from one article displayed as:

> **Reuters: NVDA margins · p.2**

There is no page 2. There is no page 1. It is a web article quoted twice, and a
page number asserts a paginated document exists behind it — a completeness claim
about someone else's content that Wave L deliberately refused to make.

**Fix:** `source_kind` (`"web"` | `"attachment"`) already existed from Wave L;
the search services simply never selected it. Now carried through both services
and both endpoints, formatted by **one** labeller (`lib/searchResultLabel.js`) —
two formatters over one truth drift silently, and here both spellings look
plausible.

| Source | Label |
|---|---|
| web capture | `Captured passage · Reuters: NVDA margins (reuters.com)` |
| real PDF | `NVDA 10-Q · p.47` |

⛔ A web hit carries **no ordinal in any spelling** — "capture 2" is as
meaningless to a member as "p.2". The icon follows the kind too.

---

## 2. Navigation depth — DONE

**Search result identity now matches search result destination.** Previously
every section ended at `onOpenNote({ id: noteId })`, so Search could correctly
say "NVDA 10-Q · p.47" and drop the member at the top of a note.

⭐ **Not a second navigation system.** It composes the two contracts that already
exist: the note opens through the same `?note=` param `NotebookTab` owns, and the
document is targeted through the same `previewDoc` shape Wave J's click-to-source
hands `DocumentPreviewSheet`, which drives `PdfDocumentViewer`'s `scrollToPage` /
`emphasizeExcerpt`. An object reached from Search lands where the same object
lands when reached from a citation — convergence, not a third adapter.

| Result kind | Destination | Depth |
|---|---|---|
| note body | the note | `note` |
| **PDF page** | note → document → **page N** | `page` |
| **PDF excerpt** | note → document → **excerpt emphasised** | `excerpt` |
| **web capture** | the owning note — **and it claims nothing deeper** | `note` |

⛔ **The web case is a refusal, not an omission.** A captured web source has no
viewer: its `attachment_url` is `web:<sha256>`, an identity string rather than a
file, and nothing in the product renders one. `navigationDepth` returns `note`
for a web capture *regardless* of whether the row arrived as a page or an
excerpt. Inventing an anchor would be the navigation twin of the `· p.2` label
defect. **Recorded as residual R-M1.**

Params are cleared on every open (so a PDF hit followed by a web hit cannot
reopen the previous document from a stale `page=47`), and the editor consumes
the target **once** — ref-guarded, replace-navigation — so a refresh or Back
does not reopen the sheet.

---

## 3. Semantic architecture decision

### The measured feasibility number that decides it

| Measurement | Value |
|---|---|
| Baseline python process (working set, measured externally) | **16 MB** |
| With torch + `all-MiniLM-L6-v2` loaded + one encode | **494 MB** |
| **Net resident cost** | **≈ 478 MB** |
| Cold load, cold OS cache | **25.2 s** |
| Warm load | 0.49 s |
| Query latency | 26 ms vs **0.8 ms** lexical |
| Index size | ~1.5 KB/passage (≈15 MB per 10k-passage member) |

⛔ Measured from **outside** the process with `Get-Process`. An in-process
ctypes probe returned `0.0 MB` for every stage — a failed instrument, not a free
lunch, and it is not reported as a reading.

**Against the web pod's reality:** one uvicorn process, one shared event loop,
production RSS observed today at 874 MB – 1.28 GB. Adding ~478 MB is a **40–55%
increase in the single shared process**, and the 25 s cold load would land either
on boot or on a request — on a pod that redeploys several times a day.

### Chosen architecture: **C + B**

> **C — semantic runs only when deterministic lexical confidence is weak,
> delivered as B — lexical returns immediately, semantic enriches progressively.**

**Why:**
- **C protects the thing lexical is best at.** Semantic costs exact-match
  precision (0.917 → 0.608). If it never runs when lexical is already confident,
  that regression cannot reach a member who typed `NVDA` or `inventory days`.
- **C targets exactly the measured failure class.** Low-overlap queries are
  precisely where lexical returns little, so "weak lexical result" is a cheap,
  deterministic, inspectable trigger — not a classifier.
- **B protects latency.** Lexical is 0.8 ms; semantic is 26 ms plus a possible
  model load. Search must never wait on the model, so results arrive in two
  passes.
- **Rejected: naive RRF** — Wave L measured no gain over semantic alone while
  still costing lexical precision. **Rejected: D (union + rerank)** — a union
  puts semantic candidates in front of exact-match queries, which is the
  precision regression restated.

**Index lifecycle:** vectors keyed by the same `(user_id, source_type,
source_id)` the FTS rows use, so trash/restore/purge inherit the existing
semantics rather than needing a second lifecycle. **Fallback:** any failure —
model missing, load timeout, index cold — degrades to lexical-only, which is the
current shipped behaviour, so the failure mode is "no worse than today".
**Tenant isolation:** the candidate set is filtered by `user_id` *before*
similarity, never after.

### Activation state: **DARK**

**IMPLEMENTED: no · BENCHMARKED: yes · ARCHITECTURALLY SELECTED: yes ·
ACTIVATED: no · BLOCKED ON: operational placement.**

The quality case is made and the architecture is chosen. What is **not**
established is that ~478 MB and a 25 s cold start belong in the single web
process. The credible placement is out-of-process (the existing worker service,
or a lazily-loaded bounded sidecar) — which is an engineering decision for a
later wave, not a flag to flip now.

⛔ **External Notebook embeddings remain blocked** without exact-project ZDR.
Nothing in this wave sends member content anywhere.

---

## 4. Search ↔ Ask consistency — the honest contract

**They are not identical, and forcing symmetry would damage both.**

| | Search | Ask |
|---|---|---|
| Weak/related candidates | **allowed** — a near-miss is often what the member wanted | **refused** — no-answer thresholds stay stricter |
| Purpose | help the member *locate* | produce a *grounded answer* |
| Corpus | notes · document pages · excerpts | the same, plus thesis state, evidence edges, financial facts |

**The contract that does hold:**
- If Search exposes an evidence object, Ask can cite it when its scope permits.
- If Ask cites an object, Search can help the member locate it.

**Intentional exceptions, documented rather than fixed:**
1. `GET /api/j2/notes?q=` (note FTS) does **not** index document/captured text —
   the Documents and Evidence sections cover it. This is the boundary that was
   mis-stated as a product gap.
2. Ask reaches thesis state, evidence edges and financial facts; Search does not
   surface those as result kinds. Deliberate — they are reasoning context, not
   things a member searches for by text.
3. Ask's note scope now reads captured pages and excerpts (Wave L Slice 5);
   Search reaches the same material through its own sections. Same corpus,
   different presentation, by design.

---

## 5. Performance

Bounded to the paths this wave changed.

| Path | Result |
|---|---|
| `source_kind` propagation | two extra columns on an existing indexed query — no new join, no new scan |
| Canonical labelling | pure string formatting, client-side |
| Navigation metadata | URL params; no request |
| Semantic | **not on any request path** — dark |

Exact lexical search is unchanged in shape and remains the fast path. **No
semantic model load can block a lexical result, because none is wired.**

⚠️ **Not done:** a large-corpus (thousands of notes / many document pages)
timing benchmark. The changed paths add no new query shape, so the risk is low —
but "low risk" is an argument, not a measurement, and it is recorded as
residual **R-M3** rather than claimed.

---

## 6. Competitive task comparison — narrow, and only what changed

⚠️ Competitor columns are current product knowledge, **not re-tested here**.

| Task | UCT after Wave M | vs Notion / Evernote / Obsidian |
|---|---|---|
| Exact phrase search | fast lexical, unchanged | **COMPETITIVE** |
| Captured web text search | found, and **now correctly identified** | **COMPETITIVE** |
| PDF/document text search | found, page-labelled, **navigates to the page** | **COMPETITIVE** |
| Truthful source identification | source-kind-aware labels | **SUPERIOR** — the others present one flat result type; none distinguishes "a page of a document I hold" from "a passage I clipped from the web" |
| Click-through to the object | page / excerpt / note, at the deepest truthful level | **COMPETITIVE** |
| Low-overlap paraphrase retrieval | architecture selected, **DARK** | **MATERIAL GAP** — Notion's and Evernote's semantic search ship; ours does not, and it is not claimed |
| Speed | 0.8 ms lexical | **COMPETITIVE** |
| Mobile | inherits the responsive sidebar | **UNVERIFIED** this wave |

⛔ **Semantic capability is not inflated: it is dark, and the table says so.**

---

## 7. Residuals

| # | Residual | Why it stands |
|---|---|---|
| **R-M1** | A web capture navigates only to its owning note. | No viewer exists for `web:<sha>`. The honest floor; inventing an anchor would repeat the label defect. |
| **R-M2** | Semantic retrieval is dark. | ~478 MB + 25 s cold load in the single web process is not justified yet. Needs out-of-process placement. |
| **R-M3** | No large-corpus timing benchmark. | Changed paths add no new query shape; risk argued, not measured. |
| **R-M4** | Search UX/mobile pass not re-run. | The changes were label + destination, both covered by component rails. |
| **R-M5** | `notes?q=` still doesn't index document text. | Correct by design; the sections cover it. Only becomes a gap if the sections are ever removed. |

---

## 8. Exit standard

| # | Criterion | State |
|---|---|---|
| 1 | Results truthfully identify source kind | ✅ |
| 2 | Capture ordinals never presented as document pages | ✅ |
| 3 | Navigation reaches the represented object at the deepest truthful level | ✅ (web = note, by refusal — R-M1) |
| 4 | Exact lexical search fast and precise | ✅ unchanged |
| 5 | Semantic has an evidence-based architecture decision | ✅ C + B |
| 6 | Semantic activation state explicit | ✅ **DARK — blocked on operational placement** |
| 7 | Search↔Ask consistency documented truthfully | ✅ §4 |
| 8 | Large-corpus regression acceptable | ⚠️ **R-M3** — not measured |
| 9 | Focused competitor comparison updated | ✅ §6 |

**Rails:** 7 mutation checks across the wave (corpus removal · cross-tenant ·
`source_kind` dropped · label reverts to `p.N` · deleted source left indexed ·
page-target navigation reverted to a bare note open · web capture claiming a page
target), each byte-identical restore, each with a positive control.

**Regression:** 209 files / 2112 tests green at `--maxWorkers=4`; backend corpus
contract 10/10. Pre-existing reds inherited from master are named in §9 of the
Wave L closure and were not touched.
