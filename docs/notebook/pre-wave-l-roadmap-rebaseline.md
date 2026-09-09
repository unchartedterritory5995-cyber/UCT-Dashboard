# Pre-Wave-L Roadmap Re-Baseline

**Date:** 2026-09-07 · **Supersedes:** the ranking half of
`post-wave-k-roadmap-rebaseline.md` (its findings and rulings stand; §6 still governs).
**Status:** PLANNING ONLY. Wave L is not authorized by this document.

**The question:** *after Waves A–K and the integrity mini-pass, what still forces a
serious investor/trader to keep Notion, Evernote or Obsidian open beside UCT?*

---

## 0. Why this re-baseline exists at all

The previous one got a load-bearing item **wrong**: it called Notebook's
command-palette absence "the cheapest high-leverage UX gap" and put it in Wave L.
Notebook has participated in the palette since Wave B. I had grepped
`pages/journal-2-0/` for a *registration* and found none — but `CommandPalette.jsx`
**pulls** from Notebook rather than being registered into.

⛔ **Every capability claim below was therefore re-verified by asking the module
that owns it**, not by grepping for a name
(`lesson_grep_for_a_name_finds_one_ask_the_module_finds_ten`). Where a claim is
inferred rather than observed, it says so.

---

## 1. What the product actually is now — verified

**Shipped and confirmed in code this session:**

| Capability | Evidence |
|---|---|
| Ask, four scopes | `ask_service._SCOPES` = note · document · security · notebook |
| Ask's corpus is **five** source types | `ask_evidence.SOURCE_TYPES` = note · document_page · document_excerpt · **financial_fact** · **thesis_state** |
| Documents, page-anchored excerpts, thesis evidence | Waves I/J, routes live and gated |
| Frozen financial facts | Wave F |
| Thesis objects + changelog | Wave G |
| Per-ticker research workspace | Wave H |
| Saved views + structured properties | `SavedViewEditor.jsx`, `useJ2SavedViews.js` |
| Templates | `TemplatePicker.jsx`, `lib/notebookTemplates.js` |
| Command palette (New note · Open · Search · Trash · note rows) | `CommandPalette.jsx` + `notebookNoteRowsMatch()` |
| Import connectors (Notion/Evernote/Obsidian/OneNote…) | certified, 60-user |
| Frozen-at-insert temporal correctness | Wave F + the G-063 gate from the mini-pass |

**Absent, and confirmed absent:**
web capture · OCR · semantic retrieval of any kind · a visible semantic search ·
offline (no service worker) · a real PWA (`manifest.json` is a stub: `start_url:/dashboard`,
one SVG icon, no 192/512 or maskable) · mobile share-sheet capture · note-body
encryption at rest (`NoteBox` protects connector tokens, not note content) ·
public API/webhooks · finance-native reminders or review dates (`j2_day_notes`
rules are a daily checklist, not a per-thesis review loop).

**Implemented but not authorized:** public share links — G-080, activation
disabled, authorization unverified.

**⭐ The thing worth naming plainly:** Ask already answers over *frozen financial
facts and thesis state*, not just prose. **No generic notebook can do that at
all.** The moat is real and further along than the last re-baseline credited.

---

## 2. The honest answer

**What still forces another product open, in order of how often it bites:**

| Blocker | Who, how often | Competitors |
|---|---|---|
| **No web capture** — a filing, a news piece, a blog post read in a browser cannot enter UCT | Everyone, several times a day | All three (Evernote's clipper: article / simplified / screenshot / annotated) |
| **No recall by meaning** — "margin pressure" misses "gross margin normalization"; and there is no semantic *search box* either, only Ask | Everyone, weekly → daily as the corpus grows | Notion, Evernote (cloud); Obsidian via a **local** model |
| **No mobile capture** — no share-sheet; the PWA is a stub | Everyone who reads on a phone | All three |
| **No OCR** — a scanned 10-K or a chart screenshot is text-invisible | Document-heavy members | Evernote |
| **No offline** | Obsidian switchers especially | Obsidian (native), Evernote, Notion (degraded) |
| **Note bodies plaintext at rest** | Anyone told this is their primary store | Baseline expectation |

**And the second half of the standard — does UCT make generic notebooks feel
incomplete for an investor?** Already yes, and increasingly: nothing in Notion,
Evernote or Obsidian has a thesis object with an evidence graph, a frozen
financial-fact ledger, page-anchored document evidence, or an assistant that
answers over all of it with verified citations and refuses when the corpus can't
support an answer.

⭐ **So the strategic risk is not that UCT is insufficiently financial. It is that
a member cannot get material IN (web, mobile, scanned) or FIND it again by
meaning — the two boring capabilities that decide whether a notebook becomes the
primary one.** Everything distinctive is downstream of those two.

---

## 3. Ranked against the ten criteria

Scored 1–5 per criterion (5 = strongest case for doing it next). **Dependency
order** scores high when nothing blocks it and other work depends on it.

| # | Item | Switch-blocker | Freq | UX | Fin. diff | Dep. order | Trust | Mobile | Parity | Acq. | Ret. | **Σ** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Web capture** (+ the 4 uncovered internal surfaces) | 5 | 5 | 4 | 3 | 5 | 3 | 3 | 5 | 5 | 4 | **42** |
| 2 | **Mobile capture + real PWA** | 4 | 5 | 4 | 2 | 4 | 3 | 5 | 5 | 4 | 4 | **40** |
| 3 | **Semantic recall + visible semantic Search** | 5 | 4 | 5 | 3 | 2\* | 4 | 3 | 5 | 3 | 5 | **39** |
| 4 | **Finance-native review loop** (thesis review dates, catalyst reminders, invalidation) | 1 | 4 | 4 | **5** | 4 | 3 | 3 | 1 | 4 | **5** | **34** |
| 5 | **OCR / scanned-document intelligence** | 3 | 2 | 3 | 3 | 2\* | 3 | 2 | 4 | 3 | 3 | **28** |
| 6 | **Note-body encryption at rest** | 2 | 1 | 1 | 1 | 3 | **5** | 1 | 3 | 3 | 3 | **23** |
| 7 | **Offline read cache** | 3 | 2 | 3 | 1 | 3 | 2 | 4 | 3 | 2 | 2 | **25** |
| 8 | **Note-level keyboard shortcuts** (what actually remained of G-102) | 1 | 4 | 3 | 1 | 4 | 1 | 1 | 3 | 1 | 3 | **22** |
| 9 | **Ask + live UCT/Terminal fusion** (G-052) | 1 | 2 | 3 | **5** | 1\*\* | 2 | 2 | 1 | 3 | 4 | **24** |
| 10 | **Sharing/publishing activation** (G-080) | 1 | 1 | 1 | 1 | 1\*\* | **5** | 1 | 2 | 2 | 1 | **16** |
| 11 | **API / extensibility** | 1 | 1 | 1 | 2 | 2 | 2 | 1 | 2 | 2 | 2 | **16** |

\* **Blocked on a privacy decision, not on effort** — the dependency score reflects
that it cannot start today, not that it is unimportant.
\*\* **Blocked on an external legal/authorization decision**, not engineering.

---

## 4. Recommended sequence

### ⭐ Wave L — CAPTURE EVERYWHERE (revised)

*Items 1 and 2. Not "Capture & Command" — the Command half was retracted.*

One capture contract, three doors:

1. **Web capture.** G-043's rejection predates the destination existing: there was
   no document model, no excerpt, no thesis, no Ask to capture *into*. The
   high-value form is not a generic inbox — it is **capture a page or selection
   straight into a ticker's research**, where Wave H already put the workspace.
2. **The four uncovered internal surfaces** — Screener, Options Flow, COT, Model
   Book. Cheapest win available: the mechanism exists at nine call sites and is
   simply not wired at four.
3. **Mobile capture + a real PWA** — share-sheet target, proper icon set,
   `start_url` that lands in Notebook.
4. **Rider, small:** note-level keyboard shortcuts — the genuine remainder of the
   old G-102 item, now that palette participation is known to exist.

**Goal:** *anything I encounter can enter my research in one step, from any device.*

### Wave M — PRIVATE RECALL

Ranked #3, and the highest-value item that is **decision-blocked rather than
effort-blocked**. Per the standing ruling: **one privacy/compute evaluation, two
separate technical benchmarks** — a local embedding model and a local OCR engine
are not the same capability, and a combined verdict would hide which one failed.
Benchmark first; a competitor using a model is evidence the shape works, not that
the model suits this corpus on this pod.

⭐ **Recommendation: run that benchmark as a bounded measurement DURING Wave L.**
It is measurement, not implementation, it needs no production change, and it means
Wave M can start with an answer instead of a question. If local clears, semantic
recall AND OCR both unblock with no vendor-retention question at all — and the
ZDR conversation stops being on the critical path.

**Wave M's product surface is two things, not one:** the semantic leg behind Ask,
**and a visible semantic Search** — the member should be able to *search* by
meaning, not only *ask*. Today the search box is FTS5/bm25 only (`sort=relevance`
opt-in), so "find that thing I wrote" and "ask a question" are different
capabilities with different recall.

### Wave N — THE FINANCIAL REVIEW LOOP

Lowest switching-blocker score and the **highest differentiation and retention**
score on the board. It composes what already exists — Wave F facts + Wave G thesis
and evidence + Wave H workspace + Wave K Ask — rather than introducing a parallel
object model. ⛔ Not generic todo parity: *UCT brings me back to the investment
decision when something I said mattered needs reassessment.*

### Wave O — DURABILITY & TRUST

Offline read-only cache, note-body encryption at rest (the design spike G-004
already names — the hard part is keeping FTS5 working under encryption, not key
management), mobile deepening, export/portability hardening.

### Deferred, and why

**G-052 (Ask + live vendor data)** and **G-080 (sharing activation)** are both
gated on decisions outside engineering; neither is scheduled work. **API /
extensibility** is not a pre-launch switching blocker for a single-member research
tool. **Multiplayer/collaboration** needs an account/team primitive UCT's auth does
not have — a platform change, not a Notebook increment.

---

## 5. Debt this re-baseline does not schedule

- **G-128** — 104 raw-error violations across 32 files in the trading tabs and
  modals, 12 of them native `alert()`. Quantified, railed in the Notebook scope;
  widening `IN_SCOPE` in `rawErrorSurface.test.js` is one line when scheduled.
- **The FolderSidebar copy trade-off** — a helpful server message is now withheld
  because at the catch site it is indistinguishable from a stack fragment. The fix
  is an API layer that marks member-safe details.
- **Wave J/K residual** unchanged: four low-overlap paraphrases still miss; a
  shared generic word can lift `no_answer`; 16 orphaned `floor2`/`community`
  modules from `cc195e888` are not Notebook's.
- **Semantic retrieval: architecturally approved, quality-justified, NOT
  ACTIVATED, blocked on exact-project ZDR. No Notebook content has been sent to
  the embedding endpoint.**

## 6. The cap on all of it

**Zero real-member usage evidence.** Every number in §3 is a judgment about what
members will need, not a measurement of what they do need. The first genuine
cohort should be allowed to reorder this table — and the ordering above is
deliberately built so that the two items a cohort is most likely to confirm
(capture and recall) come first.
