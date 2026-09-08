# Wave N §1 — the `document_excerpt` downstream audit

**Question the directive asked:** a captured web passage is attached to a thesis
under the *existing* `document_excerpt` target type. Is that target type still
truthful once its members are no longer all PDF excerpts — and does every
downstream consumer still say the right thing?

**Verdict: the target type is right; three consumers were not, and one of them
was live and member-facing.** The fix is never a second taxonomy.

---

## The decision, stated once

`thesis_evidence.TARGET_TYPES` is the **relational namespace** — what kind of
object an evidence edge points at. It is not the source's semantics.

A captured web passage IS a `document_excerpt`: it lives in `j2_note_excerpts`,
it hangs off a `j2_note_documents` row, it carries `captured_text`, an
annotation and an anchor. Inventing `web_excerpt` would fork the evidence model
to describe a difference the **stance never cares about** — and every consumer
would then need to handle two types where today it needs to handle one column.

⛔ **The disambiguator is `source_kind` / `capture_type` on the document row,
and every consumer must read it.** That is the rule this audit enforces, and
the three defects below are all one failure to follow it.

---

## Defect 1 — export serialised a web capture as a PDF page (FIXED)

`notes_export._resolve_thesis_evidence_by_note` labelled **every**
`document_excerpt` as `"{document name}, p.{page_number}"` — Wave J's
page-is-the-citation-unit convention, correct when the only member of that type
was a real PDF excerpt.

An exported thesis therefore read:

```
Reuters: NVDA margins, p.2
```

A page of an article that has no pages, in the **one artefact that leaves UCT
entirely** and lands in the member's permanent archive. Fixed by branching on
`source_kind`; the real-PDF path still exports `p.47`.

Rail: `tests/test_evidence_export_source_truth.py` (5, incl. the §8 PDF control).

## Defect 2 — the attached-evidence row was a fourth formatter (FIXED)

`ExcerptEvidenceRow` in `ThesisSection.jsx` formatted `${documentName} · p.${pageNumber}`
from its own local lookup and fell through to the literal string
`'Document excerpt'` for a web capture — because a capture has no
`j2_note_excerpt_refs` sidecar row, which is what that lookup reads.

Fixed by routing the attached row through the canonical labeller
(`searchResultLabel.searchResultTitle`) over the evidence-candidate record, with
the local excerpt as a fallback and `'Saved evidence'` as the floor.

Rail: `ThesisSection.test.jsx` (23).

## Defect 3 — ⛔ Ask told the model and the member "· p.1, document_complete" (FIXED)

**The expensive one, and it was live in production.**

Wave L wrote the correct branches:

* `ask_evidence.passage_label` → `"{name} · captured passage {n}"` for a capture
* `ask_evidence.coverage_for` → `selected_passage_only`, not `document_complete`

Both keyed on `capture_type`. **No Ask query selected that column.** So the
branch was unreachable from every real query, in every scope, and a captured
Reuters paragraph reached:

* the **model**, through `ask_prompt`'s `label: …` line, and
* the **member**, through `ask_service.public_source`

as `Reuters: NVDA margins · p.1` with `coverage: document_complete` — a page
that does not exist, plus a claim to hold a whole article we hold one paragraph
of. (The per-item `coverage` value has no consumer downstream *today*; the
label has two. Both were wrong; only the label was visible.)

### Why it stayed green

`tests/test_web_capture_coverage.py` builds its rows **by hand** with
`capture_type` present. It proves the branch is correct and is structurally
incapable of noticing that no query supplies the column
(`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). One of its cases
even pins "a row with NO capture_type is a pre-Wave-L pdf" — a correct
back-compat default that doubled as the mask.

### The defect underneath it

⛔⛔ **Two columns answer one question.** `capture_type`
(`pdf_full_text | web_passage | web_reference`, Wave L) and `source_kind`
(`attachment | web`, Wave M) both answer *"is this a web capture"*, and
different layers picked different ones — Wave M taught the **search** queries
`source_kind`, Wave L taught the **evidence envelope** `capture_type`, and
nothing joined them. `lesson_a_second_authority_over_one_value`.

### The fix

* **`web_capture.capture_columns(conn, alias="d")`** is now the ONE place that
  names those columns and the one place that asks whether this schema has them.
  All six Ask queries and both search modules splice it.
* `ask_evidence.is_web_capture(row)` accepts **either** column —
  `capture_type` first, because only it separates a captured passage from a
  reference-only capture. `coverage_for_row(row)` prefers the finer column and,
  for a row that says only `source_kind='web'`, floors at
  `selected_passage_only` rather than falling through to complete.

Rail: `tests/test_evidence_capture_kind.py` (17) — every Ask scope, through the
**real** retrieval SQL, plus the PDF control and the schema-adaptivity cases.
Seven attributed mutations, all red as required (see below).

---

## ⚠️ Also fixed here: Wave M left 28 Ask tests red on this branch

Wave M selected `d.source_kind` / `d.source_url` **unconditionally**. Several
Ask suites legitimately build a minimal schema of exactly the tables they
exercise, so every such query raised `no such column: d.source_kind`.

Measured on this branch:

| | ask_retrieval | documents_router | excerpts_router | total |
|---|---|---|---|---|
| before Wave M (`6cac94274~1`) | 0 | — | 9 | — |
| at HEAD (`998ab87dd`) | 28 | 3 | 9 | **40** |
| after this change | 0 | 3 | 9 | **12** |

⛔ **A `no such column` catch could not have fixed it.** That error is
indistinguishable from a real failure and swallowing it turns one into a
confident empty result (`lesson_a_swallowed_error_becomes_a_confident_finding`)
— which is precisely why `_no_capture_tables` was written narrow. Asking the
schema is the only way to tell *"this database cannot hold a capture"* from
*"something is broken"*, and it is what `capture_columns` does.

**The remaining 12 are not code.** Every one of them uploads an attachment, and
`notes_quota.assert_import_headroom` refuses on this box: the volume has
**~1.02 GB free against a ~49.9 GB required reserve**, so every upload 400s.
Product-correct behaviour, environment-limited. ⚠️ **§2's flagship E2E and §8's
PDF control must not route a real upload through that endpoint on this machine**
— insert the document row directly, as `TestTheDocumentControl` does, or free
disk first.

---

## §6 — curation cannot manufacture corroboration (verified, rails added)

Once a captured passage is attached to a thesis it is reachable two ways: as the
research itself, and through the thesis edge. ⛔ **Those are not two independent
corroborating sources.** Attaching a quote says something about the member's
judgement, not about how many publishers said it.

The protection already existed and is deliberate — `from_excerpt` shares the
**page's** `lineage_key`, and `_thesis_edge_evidence` **marks** an object already
retrieved (`by_source.get(...)`, `continue` when absent) rather than appending
one. Wave N makes a new class of object eligible for that edge, so the invariant
is now railed *for that object*: `tests/test_evidence_ask_lineage.py` (5) asserts
**source identity**, not a result count — one lineage key, the edge marks rather
than adds, an edge whose object was not retrieved contributes nothing, and a
stance never appears inside what the source is quoted as saying.

---

## Deliberate divergence, recorded so it is not "fixed" by accident

The picker (`evidence_candidates`) exposes **no ordinal at all** for a web
capture; Ask's `passage_label` says `"… · captured passage 2"`.

That is not drift. The picker lists a single note's candidates **beside their
own text**, where an ordinal adds nothing. A citation list must let a member
tell three passages from one Reuters article apart, and "captured passage 2" is
a true sentence about the second passage they clipped. What Wave M banned was
rendering that ordinal as **`p.2`**, a page — not saying what it is.

---

## Mutation proofs (all RED as required, byte-identical restores)

| mutation | expected red |
|---|---|
| `capture_columns` always projects nothing | `test_note_scope` |
| the corpus row projection drops the capture kind | `test_corpus_scope` |
| the schema check is skipped (Wave M's unconditional select) | `test_a_healthy_anchor_earns_an_exact_citation` |
| `is_web_capture` ignores `capture_type` | `test_capture_type_alone_answers` |
| `is_web_capture` ignores `source_kind` | `test_source_kind_alone_answers` |
| `coverage_for_row` loses its web floor | `test_a_source_kind_only_web_row_does_not_claim_completeness` |
| `passage_label` loses its web branch | `test_note_scope` |

## Suites green after the change

`test_evidence_capture_kind` 17 · `test_evidence_ask_lineage` 5 ·
`test_evidence_export_source_truth` 5 · `test_evidence_candidates` 16 ·
`test_ask_retrieval` (28 recovered) · notebook family sweep 211 ·
frontend `ThesisSection` + label/navigation/capture-context 54.
