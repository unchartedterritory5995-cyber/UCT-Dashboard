# Wave P4 — OCR excerpt → thesis evidence → review

```
SELECTION       a "Scanned text" panel inside the existing viewer, one page
SOURCE-BACKING  a quote must resolve against the canonical page text
EVIDENCE        document excerpt, page-level provenance, member note separate
LINEAGE         page + excerpt + thesis relationship = ONE source
PRODUCTION OCR  OFF · zero member documents processed
RESIDUAL        P2-LINUX-OCR-VERSION-CERT still open
```

## A · ⚰️ The hole: a quote nobody checked

`create_excerpt` re-verified that the note and the document belong to the member
and **never once asked whether the passage it was about to store as a QUOTE
appears on the page**. A client could post *"Revenue was $99 billion"* and it
was filed as an excerpt of a real filing, on a real page, with a working
citation. The member may write that sentence in **their own note**; they may not
have it stored as source text.

Selections on OCR-owned pages now resolve against the canonical page text,
whitespace-normalised so a wrapped line is still the same passage — and nothing
else is forgiven. No dictionary, no case folding, no punctuation stripping.

⚰️ **Native pages are deliberately out of scope, and that is not laziness.** A
native selection comes from pdf.js's text layer while the canonical row comes
from pypdf: two extractions of one page that disagree about ligatures,
hyphenation and soft breaks. Demanding equality between them would reject honest
quotes, and Wave J's anchor-integrity verdict already tells the truth there.

⭐ **And it covers the unreadable page for free.** A page whose OCR the usability
gate rejected holds an EMPTY canonical row, so nothing is source-backed against
it and no excerpt can be created from it — no second rule, no special story.

**Proven against the live route, as a real client would attempt it:**

```
POST …/excerpts  "Revenue was $99 billion"             → 400 not on the scanned page
POST …/excerpts  "Diluted earnings per share were $3.18" → 200
```

## B · The selection surface

A scanned page has no text layer, so the member could read a figure and not
quote it. ⛔ **Faking a text layer into the PDF was rejected**: it would make
derived text indistinguishable from the page's own, which is the single
distinction this wave exists to preserve.

Instead the existing viewer gains a **Scanned text** panel for the page on
screen — a selection aid, never "the document", never a second viewer. It says
what to do (*check exact figures against the page itself*), fetches **one page**,
and hands the viewer the same text+offset map a rendered text layer would, so
**Save excerpt works through the existing capture path** rather than a second
one. The offsets it stores are offsets into the very text the server checks the
quote against.

## C · ⚰️ Two gating signals that were intermittent in the live product

The first version decided *"this page is a scan"* in the browser, from an empty
pdf.js text layer, and decided *"which page"* from `virtualizer.getVirtualItems()`
during render. Both proved **intermittent**: the panel appeared on one load of a
page and not on the next, with the text layer measurably empty both times.

⛔ **A feature that is sometimes invisible is worse than one that is missing**,
because nobody can reproduce it. Only the browser could have shown this — every
unit rail passed throughout.

Replaced with two facts that cannot race: the page comes from **scroll
position** over containers the viewer already registers, and whether to offer a
transcript at all comes from the **server's stored `text_origin`**. Verified
stable across three consecutive checks after the change.

⛔ A second defect the rails caught rather than the screen: the effect that hands
the transcript to the viewer did not depend on `open`, so it last ran against a
null ref and the viewer was never given the text — a selection would then fall
back to searching the EMPTY page layer and store no offsets at all.

## D · Evidence, and what it is not

An OCR-derived excerpt is an ordinary `document_excerpt`: no `ocr_excerpt`
taxonomy, no second source object, no separate lineage. Provenance is **derived
from the page** in both the excerpt read and the candidate read, so an excerpt
can never claim a provenance its own page disagrees with.

The picker shows `<document> · p.N` with a quiet **Scanned text** chip, the
selected passage, and the member's own note **as a separate field** — because
the picker is where a member decides which of the two they are attaching.

⛔ **Stance is the member's.** UCT never infers supporting/opposing from the text.

## E · One source, proven by the collapse

```
scanned page  →  OCR text  →  saved excerpt  →  thesis evidence
                     one lineage key · independent_sources = 1
```

⚰️ **The first version of this rail was vacuous and a mutation caught it.** It
asked note scope, which reaches excerpts only through the note body's sidecar —
so it retrieved the page alone and "one distinct lineage" was trivially true of
one item. It now proves the **collapse**: exactly one survivor, it is the
curated record, and `absorbed` names the page it swallowed.

A second vacuous rail, same session: the navigation assertion checked the
document id and page but **not the kind**, so a citation routed to a derived
view sailed through it.

## F · History is not rewritten

A saved excerpt is historical member research. Re-running OCR with a different
adapter changes the page's current text and **does not touch the excerpt** —
railed by actually re-running it, not by asserting an intention. The module's
own shape is what guarantees it: no function rewrites `captured_text`.

## G · The flagship, in the product

Fail-closed sandbox, real Tesseract, synthetic fixture: scanned page → **Scanned
text** panel → select *"Total revenue was $12.48 billion"* → **Save excerpt**
appears → saved with `textOrigin: ocr`, page 1, real offsets (98–130) → picker
labels it → attached as **opposing** evidence with the member's note kept apart
→ retrieval collapses page and excerpt to one source → every record still points
at the original page. Toggle measures exactly **44px**; no horizontal overflow.

⚠️ **Not verified: the transcript flow on a phone viewport.** The same-origin
iframe harness that worked for P3's Ask surface did not reproduce the document
viewer's open-from-URL flow at any width, so the mobile numbers here are from
the desktop instance (44px toggle, no overflow, `max-height: 40vh` panel).
Carried into P5's mobile lane rather than claimed.

## H · Still open

⛔ **`P2-LINUX-OCR-VERSION-CERT`.** Production runs Tesseract 5.3.0; every number
in Wave P was measured on 5.4.0 with byte-identical `eng.traineddata`. No 5.3.0
quality claim is made anywhere. Production OCR stays off.
