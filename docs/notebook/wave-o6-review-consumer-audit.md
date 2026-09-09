# Wave O6 §12/§31 — every consumer of a completed thesis review

⚰️ **Why this document exists.** Wave O added a new object class — a completed
thesis review — and wired it to the surfaces that *create* it. It wired it to
nothing that *finds* it. Search returned notes, document pages and saved
excerpts; Ask could describe the current thesis and never what the member
decided about it. Every review suite was green throughout, because a suite that
tests a producer never asks a consumer a question.

That is the same defect shape Wave N's target-type audit found seven times
(`wave-n-target-type-audit.md`), and the rule it produced is the one this
document applies:

> ⛔⛔ **A NEW OBJECT CLASS ELIGIBLE FOR AN EXISTING RELATIONSHIP REQUIRES A
> DOWNSTREAM-CONSUMER AUDIT.** Enumerate every consumer, classify each, and
> leave no unexplained red row. "Built, tested, green and unreachable" is a real
> failure mode, not a hypothetical.

**Every row is one of three things, and the third is not a euphemism for the
first:**

- **SUPPORTED** — the consumer reads reviews, and something fails if it stops.
- **NOT APPLICABLE** — the consumer's subject cannot have a review. Recorded so
  the absence is a decision on the record, not a gap nobody looked at.
- **OUT OF SCOPE (deliberate)** — it *could* consume reviews and does not, for a
  stated reason. These are the rows worth re-reading next wave.

---

## A. Producing and holding a review — shipped in Wave O

| # | Consumer | Verdict | Evidence |
|---|---|---|---|
| 1 | Review panel (`ThesisReviewSection`) | **SUPPORTED** | `ThesisReviewSection.test.jsx` · `tools/wave_o_e2e.py` steps 4-20 |
| 2 | Research Home "Needs review" queue | **SUPPORTED** | `test_review_queue.py` |
| 3 | "What changed since your last review" | **SUPPORTED** | `test_thesis_reviews.py` · `thesis_review_changes.py` |
| 4 | Note export front matter | **SUPPORTED** | `notes_export.py::_resolve_reviews_by_note` · `test_review_lifecycle_and_export.py` |
| 5 | Account deletion | **SUPPORTED** | `account_purge.py` lists `j2_thesis_reviews` · `docs/account-deletion-manifest.md` |
| 6 | Note deletion | **SUPPORTED** | `j2_notes_thesis_reviews_ad` trigger (`db.py`) — a deleted note takes its reviews with it |

## B. Finding a review — the O6 work

| # | Consumer | Verdict | Evidence |
|---|---|---|---|
| 7 | Search — **Thesis reviews** section | **SUPPORTED (new)** | `review_search.py` · `GET /api/j2/reviews/search` · `test_review_recall.py::TestSearchCanFindAReview` · `FolderSidebar.test.jsx` · `tools/wave_o6_e2e.py` S0-S2 |
| 8 | Search — Notes (`j2_notes_fts`) | **NOT APPLICABLE** | A review is not a note and is never written into one (§2). Putting review prose in a note body would make the note's own text a lie. |
| 9 | Search — Document pages | **NOT APPLICABLE** | A review has no document and no page. |
| 10 | Search — Saved excerpts | **NOT APPLICABLE** | An excerpt is a passage kept from someone else's source; a review is the member's own conclusion. |
| 11 | Search-result navigation | **SUPPORTED (new)** | `searchNavigation.js` depth `'review'` + `?review=` · `searchNavigation.test.js` · `tools/wave_o6_e2e.py` S3 |

## C. Being answered from a review — the O6 work

| # | Ask scope | Verdict | Evidence |
|---|---|---|---|
| 12 | **Current Note** | **SUPPORTED (new)** | the thesis's own history, up to `NOTE_SCOPE_REVIEW_HISTORY`, retrieved by chronology *and* by text · `test_review_recall.py::TestTheAskScopesConsumeReviews` · harness A1/A2/A3 |
| 13 | **Security Research** | **SUPPORTED (new)** | scoped by the same note membership as every other item, so an AAPL review is structurally unreachable from an NVDA question (§10) · harness S22 |
| 14 | **My Notebook** | **SUPPORTED (new)** | text matches always; chronology only once the question has narrowed to a security — "the latest review of every thesis" is a floor, and a floor is how an unrelated question comes back answered with the member's research |
| 15 | **Document** | **NOT APPLICABLE** | The scope is one source object. A document does not have a thesis, so it cannot have a review. Pinned by `test_a_document_scope_is_not_given_reviews`, which reads `retrieve_document`'s source rather than trusting this table. |
| 16 | Ask citation → navigation | **SUPPORTED (new)** | `NoteEditorPage::jumpToCitation` routes `kind: 'review'` through the same `?note=` contract Search uses |
| 17 | Prompt: authorship + chronology | **SUPPORTED (new)** | `_AUTHORSHIP` block + `review_ordinal`/`review_total` in `_PAYLOAD_FIELDS` · `test_the_prompt_is_told_the_position_and_the_decision` |
| 18 | Corroboration counting | **SUPPORTED (new)** | `corroborates=False` — curation is not corroboration (§15) · `test_it_does_not_corroborate_a_claim` |

## D. Deliberately not wired

| # | Consumer | Verdict | Why |
|---|---|---|---|
| 19 | Thesis changelog | **OUT OF SCOPE (deliberate)** | The changelog is a **computed read with no write path** (`thesis_changelog.py`), and its subject is *what changed about the thesis*. A review that concluded "no change" changed nothing about the thesis, and a review that concluded "revised" is already represented there by the version the member actually edited. Adding reviews would make the changelog a second review history — a second authority over one value. |
| 20 | Semantic retrieval | **OUT OF SCOPE (deliberate)** | Semantic remains **dark**. There is no embedding path anywhere in `api/services/journal_two/` — `ask_retrieval.py` says so in its own first three lines — so nothing here embeds review text, sends it anywhere, or touches ZDR. O6 adds no semantic dependency of any kind. |
| 21 | Public outbound share links | **OUT OF SCOPE (deliberate)** | **G-080**: share links remain IMPLEMENTED / ACTIVATION DISABLED / AUTHORIZATION UNVERIFIED, `J2_SHARE_LINKS_ENABLED=0`. A member's private judgement is exactly the content that must not become reachable through an unverified sharing path. Not touched. |
| 22 | Note-sync connectors (Obsidian, Notion, …) | **OUT OF SCOPE (deliberate)** | `NOTE_SYNC_ENABLED` is unset and `NOTE_SYNC_OBSIDIAN_ENABLED` must not be armed. A review is not part of a synced note's body, so nothing changes there either way. |
| 23 | Compass coach / voice tools | **OUT OF SCOPE (deliberate)** | Those surfaces read the trade journal, not the notebook's thesis records. Giving a coach the member's private thesis conclusions is a product decision with its own privacy surface, and O6 was not asked to make it. |

## E. Not applicable

| # | Consumer | Why |
|---|---|---|
| 24 | Recents / Favorites / "Continue working" | Keyed on note activity, not on the objects inside a note. |
| 25 | Analytics + Insights | Trade-performance surfaces. A thesis review is research, not a trade. |
| 26 | Thesis evidence edges (`j2_thesis_evidence`) | `TARGET_TYPES` is `note | fact | document_excerpt`. A review is not a *source*, so it can never be attached as supporting or opposing evidence — attaching one would let the member's own conclusion corroborate itself. |

---

## What could still make a row here wrong

⛔ **This table is not the authority; the code is.** Two rows are pinned by
tests that read the implementation rather than trusting prose — row 15 reads
`retrieve_document`'s source, row 5 is covered by the purge manifest test. The
rest are prose, and prose drifts. If you change a consumer, change the row.

⛔ **Row 26 is the one to re-read if the evidence model ever widens.** Wave N's
audit exists because `document_excerpt` was added to `TARGET_TYPES` and seven
downstream consumers were never told. `thesis_review` is deliberately *not* in
that set today; adding it later is exactly the change that would need this
document run again, start to finish.
