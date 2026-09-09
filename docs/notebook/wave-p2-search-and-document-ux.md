# Wave P2 — Search + document UX for scanned documents

```
CHAIN            upload → classify → OCR → gate → DELETE+INSERT → Search → page
PROVENANCE       an OCR-derived hit says so, a native one says nothing
HONESTY          a claim nobody can serve no longer reads as "reading…"
NAVIGATION       a scanned hit lands on the original page, like any other
PRODUCTION OCR   OFF · zero member documents processed
RESIDUAL         P2-LINUX-OCR-VERSION-CERT (production 5.3.0 not yet measured)
```

## A · What P2 actually had to close

P1 built the pipeline and P1.5 packaged the engine. Both ended at the database.
P2's question is the member's: **when Search hands back a line from a scanned
filing, can they trust it, and can they get to the page?**

Two facts the pipeline had always known and the member could never see:

1. **Where the words came from.** `text_origin` has been correct on the page row
   since P1 and stopped there. A hit on a scanned filing looked exactly like a
   hit on a native one, so a member about to quote a percentage had no way to
   know the words were DERIVED and the page — not the text — is the source of
   truth for that number.
2. **Whether anything is actually going to read it.** Pages are claimed for OCR
   only while an engine exists, but the claim OUTLIVES the capability.

## B · Provenance — a fact, never an identity, never a score

An OCR-derived document hit now carries `textOrigin` and wears a quiet
**Scanned text** chip whose tooltip says the actionable half: *check exact
figures against the page itself*.

⛔ **A label on every row says nothing**, and a label on a native page is a false
warning about a figure the member could have trusted — so native hits wear
nothing, and the rails assert both directions.
⛔ **It never names the engine** (a rail asserts the whole vocabulary contains no
`tesseract` / `ocr` / version string) and **never invents a confidence number** —
the engine supplies none we would trust, and a fabricated one is worse than
silence.
⛔ **It is not the identity.** The result is still a DOCUMENT at a real page.
`searchNavigation` is rail-pinned so a scanned hit produces a target *identical*
to the same hit natively extracted, round-trips through the URL to the same
page, and puts no provenance in the address. The mutation that drops the page
for OCR hits turns that red.

⭐ **The provenance is read by LEFT JOINing the canonical page row on its PRIMARY
KEY — not by adding a column to the FTS mirror.** That table is written by
triggers under a storage contract this wave may not touch, and a new column
there would mean a migration plus a full reindex to answer a question the
canonical row already holds. The join may add a fact but never a row: a rail
searches a two-page scan and asserts the keys are distinct, and dropping the
`page_number` condition duplicates every hit and turns it red.

## C · ⚰️ "Reading scanned text…" must not be forever

Turn the flag off, rebuild without the binary, deploy to a service that never
had one — the claimed pages remain claimed and **nothing is ever coming for
them**. The editor said *"reading scanned text…"* and would have said it
indefinitely. A spinner that can never resolve is a worse lie than "we can't
read this", because the member keeps waiting for it.

`document_text_state` now reports `ocr_unavailable` (claimed pages, no engine),
the payload carries it, and the sentence changes to *"looks like a scan — its
text has not been read, so Search and Ask cannot use it."*

⭐ **With a control rail**, because a version that always said "not read" would
have passed the first one and replaced one lie with another.

⭐ **The document STATUS deliberately stays `pending`.** The work genuinely is
pending — restore the capability and the recovery sweep serves those pages — so
the status vocabulary every consumer already reads (Ask's refusal copy included)
stays true. The *sentence* carries what is true right now. Status answers "what
is this document's state"; the sentence answers "what should I expect".

## D · The chain, link by link, and where each one is held

| link | held by |
|---|---|
| upload → native extraction | Wave I |
| classify which pages OCR owns | `plan_document` · classifier rails |
| claim ONLY if an engine exists | `TestNoEngineIsHonest` |
| OCR runs, page by page, retried and recovered | P1 job rails |
| **usability gate before the write** | design/control split, 0 errors |
| **explicit DELETE + INSERT** | `TestSearchActuallyFindsIt` + idempotence |
| Search finds the text | production search path, positive control first |
| the hit names the document and page | `test_provenance_does_not_change_what_the_result_IS` |
| the hit says it was read from a scan | slice 1 rails, both directions |
| the click reaches the original page | `searchNavigation` round-trip rails |

⛔ **And the real engine now walks it through the DOOR.** The existing
real-Tesseract E2E proved the pipeline; a second one drives the HTTP endpoint and
asserts what comes back is a document at a page the member can open, carrying
its provenance. *A service rail is not a route rail* — this program has paid for
that distinction more than once.

## E · Known limitation, stated rather than discovered later

⚠️ **A scanned page has no selectable text layer.** The viewer renders the page
image, which is exactly what §22 wants for verifying a figure — but the OCR text
lives in UCT's database, not in the PDF, so a member cannot drag-select a
sentence on a scanned page to save an excerpt the way they can on a native one.
Search finds the page and the member reads it; capturing a quote *from* it is
not possible today. That is a P4 question (excerpt → thesis evidence), and it is
recorded here so P4 meets it as a known shape rather than a surprise.

## F · The standing residual

⛔ **`P2-LINUX-OCR-VERSION-CERT` is not closed by any of this.** Production runs
Tesseract **5.3.0**; the benchmark measured **5.4.0** with byte-identical
`eng.traineddata`. Nothing in this wave may be read as re-measuring that. The
sanctioned wording stays:

> production engine 5.3.0 packaged and reachable · production-version OCR
> quality NOT YET DIRECTLY RE-MEASURED · benchmarked reference 5.4.0 with
> byte-identical English traineddata.

Production OCR remains off, and **zero member documents have been processed**.
