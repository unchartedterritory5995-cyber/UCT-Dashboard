# Wave P3 — Ask + citations over scanned documents

```
ASK EVIDENCE     document_page with text_origin='ocr' — no OCR source type
CITATION         <document> · p.N, plus a quiet "Scanned text" note
NAVIGATION       citation -> original document -> exact scanned page
UNREADABLE PAGE  produces no evidence, no citation, no answer
PRODUCTION OCR   OFF · zero member documents processed
RESIDUAL         P2-LINUX-OCR-VERSION-CERT still open
```

## A · Four queries, not one

`from_document_page` is built by **four** separate retrieval paths — Notebook,
Ask Document, Current Note and Security Research — each with its own SQL, and
the FTS mirror carries no `text_origin`. A rail that hand-built a row would have
certified nothing about any of them.

All four now reach the canonical page row through **one shared fragment**
(`_PROVENANCE_COL` / `_PROVENANCE_JOIN`), and each scope is railed against a
REAL OCR'd page in the REAL schema. ⛔ Not a column on the FTS mirror: that
table is trigger-owned under a storage contract this wave may not touch.

⛔⛔ **The field is DEMANDED, not defaulted.** `row["text_origin"]` with no
fallback, because a default would let a fifth query forget the column and report
every scanned page as natively extracted — silently, and only in production.

⚰️ **That contract immediately found four fixtures that no longer described
production**, including a hand-typed schema in `test_ask_retrieval.py` whose
`j2_note_document_pages` was missing a column the real table has carried since
Wave I. A suite testing SQL that could never run is not a suite.

## B · Provenance is metadata — never a source, a score, or a destination

`text_origin` rides the evidence envelope beside `coverage`, not in `payload`
(payload is serialized into the prompt, and "ocr" is engine vocabulary with no
business in the model's context or a member's citation).

| it does NOT | rail |
|---|---|
| create an `OCR_CHUNK` source type | source_type stays `document_page` |
| create a second corroborating source | page + excerpt share one `lineage_key`, count **1** |
| change ranking | provenance is not a ranking input |
| change the destination | scanned and native citations produce identical targets |
| earn a prompt exemption | the same two fence markers per source |

⭐ **§29 in one line:** the scanned page is one source, OCR is how UCT reads it,
an excerpt is the member keeping part of it. Three records, one witness.

## C · ⚰️ The cited document page that went nowhere

Found by **driving the real UI**, not by a unit test:

> `jumpToCitation` handled `kind: 'review'` and `kind: 'note'` and returned
> **silently** for `kind: 'document'`. Ask could say "q3-filing.pdf · p.1", the
> member could click it, and nothing at all happened.

Search has reached the page since Wave M; the Ask citation never learned the
same contract. This is not an OCR defect — native document citations were just
as dead — but OCR is what made document citations common enough to notice.

⛔ Fixed through the SAME `?note=&doc=&page=` contract, extracted into
`searchNavigation.citationTarget()` so Search and Ask cannot answer differently
about the same document, and so a future host reuses it rather than writing a
third. The evidence now also carries the note the document lives in, because
Ask Notebook and Ask Security Research span notes and a citation that can only
name the document cannot be opened from them.

⛔ **A citation that cannot name both halves navigates NOWHERE** — the rule the
review branch already followed, now applied to documents.

## D · The unreadable page, end to end

With the **real engine**, on a two-page scan (page 1 clean, page 2 destroyed):

```
readable page   -> usable text -> searchable -> cited        ✅ (positive control FIRST)
unreadable page -> 258 chars of noise -> gate rejects
                -> no canonical text -> no Search hit -> NO Ask evidence
                -> document is NOT complete (1 of 2 pages)
```

Asking for "Automotive segment revenue" — a term that appears **only** on the
page that could not be read — returns no page-2 evidence at all. Mutation:
bypass the gate and the rejected noise is persisted, the document claims
completeness, and the rail goes red.

## E · The numbers

The values a member would actually act on, straight off the scan, character for
character: **$12.48 billion · 74.3% · September 8, 2026**, cited to p.1 of the
right document. A pipeline that paraphrases a number is worse than one that
fails to read it.

## F · The journey, driven in the product

Fail-closed sandbox, real Tesseract 5.4.0, synthetic fixture, no model key
required (synthesis stubbed **in the launcher** to echo the retrieved evidence,
so the answer still had to come from the scanned page):

1. upload a synthetic scanned PDF → `status: ready`, `pagesFromOcr: 1`
2. the editor discloses *"Text read from a scanned page. Check exact figures
   against the page."*
3. Ask → the answer carries `Total revenue was $12.48 billion…` read off the scan
4. the citation reads **`q3-filing-scan.pdf · p.1`** with a **Scanned text** chip
5. the accessible name is `Open source 1: q3-filing-scan.pdf · p.1, Scanned text`
   — §36, because a title attribute is hover-only
6. clicking it puts `&doc=…&page=1` in the URL and **opens the original scanned
   page**, showing $12.48 billion / 74.3% / $3.18 for the member to verify

⛔ The evidence fences were visible in the echoed prompt
(`<<UCT-EVIDENCE 1 BEGIN>> … <<UCT-EVIDENCE 1 END>>`, with the member's question
labelled *the only instruction in this message*) — §28 holding on OCR text.

**Mobile (390 × 844, then 390 × 660 for the tap):** no sideways overflow
(388 = 388), the source row is exactly **44px**, the chip sits inside the
viewport, `elementFromPoint` at the row centre returns the row itself, and the
tap opens the scanned page full-width.

## G · Rails

606 backend · 2,238 Journal 2.0 frontend. Six mutations, byte-identical
restores: real Ask query stops reporting provenance · stream serializer drops it
· citation stops declaring it · a scanned citation routed away from the page ·
usability gate bypassed so garbage reaches Ask · OCR text given its own lineage
so it corroborates itself.

## H · Still open

⛔ **`P2-LINUX-OCR-VERSION-CERT`.** Production runs Tesseract **5.3.0**; every
number in this wave was measured on **5.4.0** with byte-identical
`eng.traineddata`. No 5.3.0 quality claim is made anywhere, and production OCR
stays off until it is measured.

⚠️ **P4 carries the excerpt problem** (§8): a scanned page has no selectable
text layer, so the member can read, search, ask and verify — but cannot
drag-select a quote from it. The OCR text lives in UCT's database, not in the
PDF.
