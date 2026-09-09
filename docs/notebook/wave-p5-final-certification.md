# Wave P5 — final certification and closure

```
SCOPE          the product a member actually touches, on the device they touch it with
PRODUCTION OCR OFF · zero member documents processed
RESIDUAL       P2-LINUX-OCR-VERSION-CERT still open
STATUS         lane A closed · B/C/D/E/F in progress · G is a STOP
```

## A · The phone, end to end

⛔ **P4 could not do this and said so.** Its flagship ran on the desktop instance
and carried "the transcript flow on a phone viewport is not verified" forward
rather than claiming it. The harness was not the problem — a P4 gating bug was.
With that fixed, the same same-origin iframe reproduces the real open-from-URL
flow at 390×844, and driving it end to end found **four defects, three of them
invisible to every unit rail in the repo**.

### ⚰️ A control pinned to an edge nobody can see

The Scanned text panel is `position: sticky; bottom: 0`. A sticky control pins
to the bottom of **its** scrollport, so the whole feature's visibility on a
phone rested on a question nothing was asking: *is that scrollport on screen?*

```
measured 390x844   toggle y=1174   viewer sized to its CONTENT (1461px in an 842px sheet)
        first fix  toggle y=845    max-height:100% — bounded, and still past the fold
         real fix  toggle y=751    the parent is a flex column; `flex: 1` finally means something
```

The first fix is the more instructive one. `max-height: 100%` resolves against
the sheet body's **whole** content box and knows nothing about the 94px bar
above it, so the viewer's bottom edge landed at y=920 on a screen that ends at
842. The toggle moved 329px and stayed invisible — ⛔ **and now invisible for a
reason that reads as fixed.**

The parent is the shared `Sheet`, so it gained one additive prop
(`bodyClassName`) rather than a global change: this sheet's body is a
non-scrolling flex column, the bar takes its height, the viewer takes the rest.
Verified after: toggle at 751–795, **44px**, `elementFromPoint` at its centre
returns the toggle itself, no horizontal overflow.

⛔ Two earlier readings of "off-screen" were a **harness artifact** and were
thrown away, not reported: Chrome defers animations in an off-screen iframe, so
the sheet's slide-up parked at `translateY(100%)`. Every measurement here calls
`.finish()` on the document's animations first.

### ⚰️ "Save an excerpt from a PDF in this note first"

Said to a member forty seconds after they saved one. The server was right the
whole time — `/evidence-candidates` returned the row — but the picker's list is
subscribed at note-open with `revalidateOnFocus: false`, and nothing on the save
path invalidated it, so the browser kept serving the empty answer it had cached
**before the excerpt existed**.

⛔ **A reload hid it**, which is exactly why nothing caught it: any check that
starts by loading the page sees a working picker. It is only reachable by doing
the two halves of the journey in one sitting, which is what a member does.

### ⚰️ A required step of the journey, under the touch floor

Setting Research Type is what grows the evidence section at all — and its
control measured **32px**. So did the rest of the panel: picker rows 36, "+ Add
property" 28, the new-property form 32, a bare 18px checkbox. The stylesheet's
phone block restructured the LAYOUT and restored no tap floor.

⛔ Restored at **≤1024**, not ≤640 — this repo has already paid for a floor that
left tablets broken. Measured after: 44 and 44 on the two controls the journey
touches.

### ⚰️ Provenance that survived only until the click

§24 put the **Scanned text** chip in the picker so a member knows the words were
read off an image *before* they stake a thesis on them. It then vanished at the
moment it starts to matter: the attached row is what they re-read weeks later
beside their own reasoning, and it read exactly like a quotation lifted from a
text PDF. The chip is now carried onto the attached row — ⛔ **only where the
origin is actually known**; an excerpt captured into another note resolves to no
candidate here, and inventing "native" from a missing answer is the claim this
wave exists to avoid.

### The eleven steps, on the phone

```
1  open the scanned document        excerpt's own source link → "Preview of q3-filing-scan.pdf"
2  arrive on the right page         toggle reads "Scanned text · page 1"
3  open the panel                   458–795, inside an 842px screen
4  read the transcript              516 chars, user-select: text, white-space: pre-wrap
5  select a passage                 "Diluted earnings per share were $3.18"   ⚠️ see below
6  Save excerpt                     44px, in viewport, hit-tests to itself
7  member annotation                "Why this matters" — a separate field, 44px
8  saved                            textOrigin ocr · page 1 · offsets 226–263 · 2s old
9  thesis evidence path             Research Type → Long Thesis → Add evidence
10 find + attach                    both candidates listed WITH the chip, no reload · opposes
11 revisit source                   the row's link reopens the document at page 1
```

### ⚠️ What this did NOT prove, stated plainly

- **The gesture.** The selection is created through the DOM Selection API — the
  same `Selection` object the viewer's `selectionchange` handler consumes, so
  every step downstream of it is the product's real path. What no automated
  harness here can drive is the **finger**: long-press, then the OS selection
  handles. Proven instead: the transcript is real text, `user-select: text`,
  carries the same `data-pdf-page-number` a rendered page carries, and a
  selection over it produces a 44px Save excerpt control that hit-tests and
  stores exact offsets into the canonical page text.
- **No highlight on a scanned page.** Returning to the source lands on the right
  page and draws **no mark on the passage** — measured 0 rects. That is
  structural, not a bug: highlight rectangles are computed from the pdf.js text
  layer, and a scan has none. A member is returned to the page, not to a
  highlighted line.
- **The fixture note carries no attachment chip.** It was uploaded through the
  API, not the editor, so the document was opened through the excerpt's own
  source link — a real product control, but not the chip path.

## B · OCR performance and concurrency

_In progress._

## C · `P2-LINUX-OCR-VERSION-CERT` — a Linux that already exists

⛔ Still open, and now it has a runway. P1.5 tried four local routes to a
runnable 5.3.0 and all four failed; the ruling was **do not install WSL or
Docker for this, and do not overwrite the working local 5.4.0**. That closed
every door on this box — and left one open that needs no door on this box at
all.

⭐ **A GitHub-hosted runner is a Linux that already exists.** The job runs inside
`python:3.12-slim-bookworm` — the same base `Dockerfile.web`'s runtime stage
uses — and installs `tesseract-ocr tesseract-ocr-eng` with the same
`--no-install-recommends`, so **the engine under test is the engine that
ships**. Nothing is installed here, nothing is overwritten here, and no
production surface is touched.

```
.github/workflows/ocr-linux-cert.yml     bookworm container, narrow path trigger
tools/wave_p_cert_corpus/                the FROZEN pages, and why they are frozen
tools/wave_p_corpus_signature.py         refuses an incomparable corpus
tools/wave_p_corpus_signature.json       the 11 page images, recorded
tools/wave_p_ocr_reference_5_4_0.json    the numbers this is measured against
tools/wave_p_ocr_version_compare.py      the delta, and no invented bar
```

⛔ **The corpus is synthetic and repo-owned, and that is a hard rule.**
Generated by `tools/wave_p_fixtures.py` from repo-tracked DejaVu fonts. No
member Notebook document, no production note, no database, no credential. The
job talks to nothing but the checkout.

### ⚰️ The trap it walked into on the first real run

The fixture corpus was **generated, not committed**, so the job regenerated it
in the container — same script, same seeds, same repo-owned fonts. **All eleven
page images came out different.** A different Pillow, a different FreeType, and
every glyph lands a hair differently.

```
run #1   corpus generated in-container   →  11 of 11 page images differ from the reference
         REFUSED before measuring anything
```

⭐ **The only reason that is a footnote instead of a published number** is that
the signature check runs *before* the benchmark. Without it the job would have
reported a 5.3.0 recall figure measured on pages nobody had ever benchmarked,
and it would have looked exactly like an answer.

⛔ **And the obvious check would have lied in both directions.** Measured on
Windows, regenerating produces eight scanned PDFs with different bytes (the
wrapper carries a timestamp) and eleven page images that are byte-identical: a
file-level check refuses a corpus that is in fact identical, and a check that
skipped the PDFs misses a real change to what the engine reads. So the signature
hashes the **decoded grayscale pixel buffer** pulled from each fixture PDF by
the same `_page_images` the benchmark uses. ⭐ Proven able to fail: flipping
**one pixel** of `scan_clean` in a throwaway copy makes it exit 1 and name the
page.

⭐ **So the corpus is frozen in the repo** (`tools/wave_p_cert_corpus/`, 2.0 MB,
10 fixtures, 15 pages). That is not a workaround — it is what makes the
experiment an experiment: the same pixels, a different engine, one variable.
The bytes are provably the reference corpus, because re-running the 5.4.0
benchmark against them reproduces `wave_p_ocr_reference_5_4_0.json` exactly —
every CER, financial-recall and search-recall figure identical, timings aside.

⛔ **And it sets no bar.** "Do not retune against 5.3.0 before first
measurement." The comparison prints the per-page delta and the benchmark's own
findings — rules that existed before the run — and says in the output that it is
evidence, not a verdict.

⭐ **The larger half of the risk was already retired, and run #1 re-measured it
rather than trusting the memory of it:**

```
tesseract 5.3.0 · tesseract-ocr 5.3.0-2 · libtesseract5 5.3.0-2 · tesseract-ocr-eng 1:4.1.0-2
eng.traineddata  sha256 7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2
                 — the same file the whole Wave P benchmark ran against
```

So the container really is production's engine, and the open delta is engine
5.3.0 vs 5.4.0 and leptonica 1.82.0 vs 1.84.1 — nothing wider.

**The reference this is measured against** (Tesseract v5.4.0.20240606, default
psm, 15 rows):

```
FTS SEARCH recall   mean 1.0 · min 1.0
financial recall    mean 1.0 · min 1.0
seconds/page        p50 0.36 · max 0.6      cold first page 0.37
```

⛔ **Production OCR stays off regardless of what the run says.** No 5.3.0
quality claim is made anywhere until the owner has read the numbers.

## D · Search / Ask / Evidence / Review, lifecycle, export, security

_In progress._

## E · Where this sits against Evernote / Notion / Obsidian

_In progress._

## F · Closure

_In progress._

## G · The gate

⛔ **STOP.** No merge. No production OCR. No `J2_OCR_ENABLED`. No Wave Q.
