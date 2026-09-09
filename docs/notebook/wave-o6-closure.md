# Wave O6 — Review Recall & Consumer Completion: closure

**Branch:** `notebook-primary-platform` · **not merged** · Wave O's merge was put
on hold for this slice, and both are now awaiting one approval together.

---

## The defect this slice closes

⚰️ Wave O shipped a place to record what the member decided about a thesis, and
nothing that could find it again.

- **Search** returned notes, document pages and saved excerpts — everything the
  member had **read**, and never what they had **concluded**. A member who wrote
  *"I was wrong about the datacenter build-out"* in a review and searched
  "datacenter" three months later got their sources back and not their own words.
- **Ask** could describe the current thesis and its evidence, and could not say
  what the member decided last time, or the time before, or when.

Every review suite was green throughout. That is the point: **a suite that tests
a producer never asks a consumer a question**. It is the same failure shape Wave
N's target-type audit found seven times, and the audit habit is what caught it
again — `wave-o6-review-consumer-audit.md` is the full matrix.

---

## What was built

### 1. A review is findable — a FOURTH search section, never a fourth score

`api/services/journal_two/review_search.py` + `GET /api/j2/reviews/search`
+ `useReviewSearch` + a **Thesis reviews** section in `FolderSidebar`.

⛔ **Sectioned, not blended.** Notes, document pages and saved excerpts are
already three separate queries rendered as three separate lists, because a page
a word happens to appear on and a passage a member deliberately kept are not
comparable hits. A conclusion reached *after the fact* is a fourth kind again.
Nothing is merged into another list's ranking.

⛔ **Completed only.** A draft is the member mid-thought; surfacing one as a
finding would show them a conclusion they have not reached.

⛔ **No new FTS table, and that is a measurement rather than a shortcut.** FTS5
earns its keep where a scan is untenable — a migrated library is tens of
thousands of notes, a filing is thousands of pages. A member's completed reviews
are a few dozen rows. A fifth index plus its sync triggers would buy a second
copy of the member's own words that can drift. **Measured**: 13.7 ms p50 / 59.5 ms
p95 on a 96-review corpus against a 400 ms budget, with a *miss* measured beside
the *hit* because a term-AND scan is slowest when nothing matches
(`tools/wave_o6_perf_out/report.json`).

⛔ **Tenancy asserted twice** — on the review and on the note it belongs to.
They are the same fact today, and a join is exactly where that stops being true
quietly. A review of a trashed thesis disappears with it and returns on restore:
the same dynamic semantics document and excerpt search already have, not a
second deletion model.

⛔ **The route is declared before `/reviews/{review_id}`.** Nothing shadows it
today; the day somebody adds a `GET /reviews/{id}`, a literal path declared
after a parameterised sibling is matched as an id and 404s with every service
test still green. That is the breadth `/live/drill` incident, and the ordering
is pinned by a test that asserts the *order*, not just the 200.

### 2. A review result lands ON the review

`searchNavigation.js` gained depth `'review'` and a `?review=` parameter on the
**same** `?note=` routing contract Search already used — not a second router.
The review panel opens its collapsed history, scrolls to the row as it attaches,
and marks it with `aria-current`.

⛔ **Not through the document reader.** A review is not a document; handing it to
the preview sheet would open a viewer over nothing. That is the same refusal
`excerptRevisitTarget` already makes for a web capture.

⚰️ **Found by the flagship harness, invisible to every unit rail:** the anchor is
cleared from the URL the moment it is consumed (so a refresh or a Back cannot
re-fire the jump), which took the prop to `null` and **un-marked the row on the
very next render**. The member clicked a result, watched the history open and
scroll, and found nothing highlighted. The mark is now latched: clean URL *and*
a visible "you are here".

### 3. Ask can answer from the member's own history

A `thesis_review` evidence type wired into the three scopes that can truthfully
hold one — **Current Note**, **Security Research**, **My Notebook** — and
deliberately not into **Ask Document**, whose subject is one source object that
has no thesis.

⛔⛔ **CHRONOLOGY IS CARRIED, NEVER INFERRED (§9).** A window function numbers
each review inside *its own thesis's* history, computed **before** any text
filter. Had the filter run inside the window, the ordinal would have been a
row's position among the reviews that happen to share vocabulary with the
question — so a two-year-old review would be labelled *"your most recent"* the
moment it was the only one matching. That is a lie told confidently, in the
member's own voice. `id` breaks a same-second tie, so "last" is never a coin
flip. The model receives `review_ordinal` / `review_total` as data and an
explicit instruction not to infer recency from anything else.

⛔ **`corroborates=False` — curation is not corroboration (§15).** A member
writing "margins are fine" in a review is not a second source saying margins are
fine. Reviews carry their own lineage so they never collapse into the thesis
they discuss, and they never inflate `independent_sources`. Those are two
different protections and a review needs both: collapsing would **hide** it,
counting it would **inflate** the claim.

⛔ **An AUTHORSHIP block in the system prompt (§8/§14).** A `thesis_review`
source is the member's own conclusion, never a publisher's finding — *"you
concluded"*, never *"according to Reuters"*. Reviews of different theses are
different histories and are never merged into one sequence.

⛔ **Per-scope history depth, not a constant.** Inside one thesis the review
history *is* the subject and all of it is fair to retrieve. Across a notebook it
is not: "the last two reviews of every thesis you own" is a **floor**, and a
floor is how an unrelated question comes back answered with the member's
research. Chronology joins the corpus-wide scope only once the question has
narrowed to a security.

### 4. The current thesis and a past decision are different objects (§16)

⚰️ **Also found by the harness.** The Current Note scope had no "now" object at
all — harmless while everything in it was current, and *not* harmless the moment
past decisions joined the packet. A thesis with a thin body and an old
`invalidated` review could be answered entirely from a judgement the member had
since reversed. `retrieve_note` now retrieves the authoritative thesis state
alongside the history, so "what do I think now" always has an authority that is
not a dated opinion.

⛔ That query reads a column some minimal test schemas do not have. It **asks the
schema** (`PRAGMA table_info`) rather than catching `no such column` — the Wave M
lesson, where a catch could not distinguish "this schema predates the feature"
from "somebody deleted a column".

---

## Evidence

### Deterministic rails

| suite | what it holds |
|---|---|
| `tests/test_review_recall.py` (29) | retrievability · chronology determinism · authorship + lineage + non-corroboration · scope · the three Ask scopes · current-vs-historical |
| `tests/test_thesis_reviews_router.py` (+4) | the search route exists, is not shadowed, is tenant-scoped, and refuses an empty query |
| `searchNavigation.test.js` (+8) | a review target, its params, and its refusal to route through the document reader |
| `searchResultLabel.test.js` (+7) | a review says it is a review — never "Document", never a page number |
| `FolderSidebar.test.jsx` (+5) | a fourth section with its own count, the decision beside the prose, and the click target |
| `ThesisReviewSection.test.jsx` (+10) | the anchor opens the collapsed history, scrolls, marks exactly one row, announces it, is consumed once, and **survives the URL cleanup** |

Notebook-family backend regression: **844 passed**. Frontend `journal-2-0`:
**2,186 passed across 211 files**.

### Mutation checks — five, each byte-identically restored

| mutation | rail that went red |
|---|---|
| the review note-scope filter removed | `test_a_question_about_NVDA_does_not_reach_an_AAPL_review` |
| `search_reviews` returns nothing | `test_a_completed_review_is_findable_by_what_the_member_wrote` |
| the chronology ordering reversed | `test_ordinals_number_the_history_newest_first` |
| `corroborates=True` | `test_it_does_not_corroborate_a_claim` |
| a review labelled "Document" | `…is never labelled as a document…` |

⛔ **Where the mutations were run, said plainly.** Each was applied to the
deterministic rail that owns the property, not to the browser harness — the
sandbox holds its Python modules in memory, so mutating a service under a
running backend would restore before the harness ever saw it. The two mutations
§20 names (*remove the review corpus* and *label a review as a Note/Document*)
are exactly rows 2 and 5 above, and the flagship harness asserts the same two
properties through the real UI. It also carries its **own negative control**
(step S0 searches a token nobody ever wrote and requires the section to be
absent), so "the section appeared" cannot be satisfied by a section that always
appears.

### Flagship harness — `tools/wave_o6_e2e.py`, every step green

Real browser, real backend, real model. Seeds two theses (NVDA, AAPL) with real
captured evidence, two NVDA reviews **1.2 s apart so the order is data**, and one
AAPL review sharing vocabulary with them.

- **S0** negative control · **S1** a review is found by the member's own word ·
  **S2** labelled `Thesis review · <thesis>`, carrying the outcome, never
  "Document" · **S3** the click lands on the review, the anchor is consumed and
  exactly the clicked row is marked.
- **A1/A2/A3** "last", "previous" and "when". ⛔ **Asserted on CITATIONS, not on
  prose.** The first cut looked for a seeded marker token in the answer and
  failed every step — because the model had paraphrased *correctly* instead of
  quoting a nonsense word. Asserting on wording measures the model's phrasing;
  asserting on the citation measures whether the right **row** was used.
- **S22** cross-thesis: a question about NVDA research retrieved neither the AAPL
  review's id nor its text.
- **S23** historical: the current thesis state is in the packet, a reversed older
  decision is never stated without saying it was superseded, and the member's own
  `thesis_status` is exactly where they left it after two reviews, one of them
  `invalidated`.

### Phone + assistive tech — `tools/wave_o6_mobile_a11y.py`, every measurement green

390×844, coarse pointer, `elementFromPoint` hit-tested at each control's centre.
Search control **44×44**, review result row **318×54**, both reaching
themselves. No horizontal overflow before or after landing (390 = 390). Exactly
**one** row marked, announced as *"Showing your review from 9/8/2026."*, and the
mark is a **2px border** rather than a colour wash — a wash is what disappears in
forced-colors mode.

---

## Instrumentation defects this slice hit, and what each taught

1. **A wait that was already satisfied.** The harness waited for the review's
   text to appear "anywhere on the page" — which it already did, in the search
   result snippet still on screen — so every later assertion ran against a
   half-loaded editor and reported a product defect that was the harness's own.
   Now it waits on the anchor being **consumed**, a signal that was false before
   the click.
2. **Asserting on model prose.** See A1/A2 above. Three consecutive "failures"
   were three correct answers.
3. **A stale `dist/`.** The sandbox serves the built frontend; the first run
   measured a bundle that predated the whole slice.
4. **A default argument capturing a tenant.** `def _thesis(user=A)` binds `A` at
   definition time, so per-test rebinding silently did not reach it and every
   count assertion collided. The same mistake cost Wave O a session.
5. **`localStorage` leaking between cases.** `CollapsibleSection` persists its
   open state for the whole test file, so "the history stays collapsed" passed
   or failed depending on which test ran before it.

---

## Machine and probe safety (§33)

- Disk checked before the heavy runs: **80.7 GB free**, and no material change
  across them. Nothing generic was cleaned.
- ⛔ **`data_sync_*` directories and `tools/e2e_sandbox_launcher.py` were not
  touched** — another workstream owns them.
- Every browser measurement ran through the Notebook-owned fail-closed sandbox.
  No ad-hoc probe reached live local product data.

## Standing gates — untouched

`J2_SHARE_LINKS_ENABLED=0`, nothing here touches sharing (**G-080** unchanged) ·
**no embedding call anywhere**, semantic stays **DARK**, ZDR untouched · no
cross-tenant reads: every query in this slice is scoped on both the review and
its note · no raw private note content in logs · account deletion already
removes reviews and still does.

---

## What is being asked for

**Merge and deploy approval for Wave O together with this O6 slice** —
`3a3122c21` through the O6 closure commit on `notebook-primary-platform`.

⛔ **Wave P — OCR / Scanned Intelligence is NOT started.**
