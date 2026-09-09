# Wave P5 — final certification and closure

```
SCOPE          the product a member actually touches, on the device they touch it with
LINUX CERT     5.3.0 measured · identical recognition to the 5.4.0 reference
RELEASE        MERGED · DEPLOYED · DARK-VERIFIED · ACTIVATED · CANARY GREEN
PRODUCTION     J2_OCR_ENABLED=1 on web only · MAX CONCURRENCY 1 · one document read
```

⭐ **Wave P is closed in production.** §H records the release; everything above
it is the branch certification that earned it. ⛔ Nothing has been rewritten to
match the outcome — the corrections, the failed canaries and the defects found
along the way are kept exactly as they were written.

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

⛔ **The question was never "how fast is Tesseract".** P1.5 measured that. The
question activation turns on is whether the pod stays a pod while a document is
being read — and the answer arrived as a defect, not a number.

### ⚰️⚰️ Two scans at once, and one of them never came back

Two 100-page documents, uploaded together, against a pod also doing its ordinary
background work. One finished. The other:

```
status = pending    pagesTotal = 100    pagesWithText = 0    pagesAwaitingOcr = 100

[doc-ocr] background job crashed for faf51fee…: database is locked
```

**Zero pages read, and nothing anywhere would ever try again.** The member's
document says "Processing…" until the next deploy — which on a quiet week means
forever.

⛔ **Three separate things had to be wrong, and all three were:**

1. **The write did not survive a lock.** `auth.db` opens with `timeout=3` *on
   purpose* — it is on the universal request path and a 10s in-driver wait
   compounds into the threadpool starvation behind the 2026-07-01 outage. A
   background job writing seconds of page text beside the pod's other writers
   loses that race eventually.
2. **§16's rule did not cover the writes.** "Page 73 failing must not cost pages
   1-72" was enforced around the OCR *call*; the two writes after it sat outside
   the guard. So one locked write took the whole document down.
3. **Recovery could not see it.** `recover_stalled` reclaims pages left
   `processing`. The write that raised was the one that *claims* the page, so
   all hundred sat in `required` — invisible to the sweep. And the sweep ran
   only at process startup.

⭐ **All three are fixed**: the write retries with backoff (a background job may
wait; the request-path idiom deliberately does not), a lock stops the run
without spending the page's retry budget and without discarding pages already
stored, and `requeue_awaiting` brings an abandoned document back — on a
**schedule**, not only at boot, self-gated on OCR actually being armed.

⛔ **Re-measured under the same contention that produced it**: all eight rounds
completed, every document reached `textComplete`, and the temp probe came back
**clean across every round**.

### The numbers

⛔ **Two runs, because they answer different questions.** Throughput and memory
come from a quiesced sandbox; survival comes from a busy one. Mixing them would
produce one table that is wrong in both directions.

```
throughput / memory · quiesced         page counts x concurrency, one member
 pages  conc      MB   wall s  s/page   RSS peak  RSS grow   read p50  read p95   vol MB
     1     1     0.2     1.10   1.099      630.5      -3.4       26.8      37.1      0.2
    10     1     1.7     4.18   0.418      648.2       4.3       10.5      28.7      1.7
    50     1     8.6    19.07   0.381      709.4      47.9       11.6      28.4      8.6
   100     1    17.2    37.26   0.373      829.4     103.2       10.6      27.2     17.2
     1     2     0.2     1.11   0.555      790.6      -0.2       12.1      24.2      0.3
    10     2     1.7     4.76   0.238      828.6       8.0       11.0      42.6      3.4
    50     2     8.6    19.95   0.200      930.1     -23.9       12.4      51.3     16.7
   100     2    17.2    37.83   0.189     1014.2     205.5       11.8      28.3     34.4
```

- ⭐ **Linear to 100 pages** — 0.418 → 0.381 → 0.373 s/page. Nothing degrades
  with document length.
- ⭐ **The semaphore of 2 is worth its full 2×.** Two 100-page scans finish in
  the wall time of one (37.8s vs 37.3s), i.e. 0.189 s/page effective.
- ⭐ **The member's app stays usable.** A real authenticated document search,
  polled every 250ms *while the OCR runs*, held a p50 of ~11ms and a p95 under
  52ms in every round.
- **Memory is the number to argue about**: ~630 MB baseline, **1014 MB peak**
  under two 100-page scans — about +385 MB. That is the figure to weigh against
  everything else sharing the pod, and it is the one real constraint this lane
  found.
- **Volume cost is 1:1 with the upload**: a 100-page scan is 17.2 MB.

⚠️ **And a ceiling nobody had noticed**: a note attachment is capped at 25 MB,
so at ~172 KB per scanned page a scanned document is effectively **capped near
145 pages** — while `document_extraction._MAX_PAGES` says 500. The two limits
disagree, and the smaller one is silent.

⛔ **CPU is measured for the WEB PROCESS ONLY, and that is a finding rather than
a gap.** Tesseract runs as a child process reading stdin, so the pod's own
process accounting sees roughly a fifth of the real cost. Capacity planning from
the web process's CPU would under-count OCR by about 5×.

⛔ **Windows, not Railway.** These are the app's own scheduling and memory
behaviour on the dev box. Lane C is where the engine's numbers come from a
bookworm Linux; nothing here is claimed as a production pod measurement.

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

### ⭐ The measurement, on the engine that ships

Run #5, bookworm container, frozen corpus, default page-segmentation mode,
pypdf pinned to the reference's version so the engine is the only thing that
changed. The report is uploaded as a build artifact (`ocr-linux-cert`):

```
reference   tesseract v5.4.0.20240606      candidate   tesseract 5.3.0

EVERY scanned page                CER identical to three places
  scan_clean  0.000 → 0.000   scan_dense 0.021 → 0.021   scan_slide 0.013 → 0.013
  scan_skew   0.000 → 0.000   scan_lowres 0.000 → 0.000  scan_twocol 0.000 → 0.000
  scan_table  0.650 → 0.650   mixed p2   0.650 → 0.650
  scan_failed_page  p1 0.000 → 0.000 · p2 1.000 → 1.000 · p3 0.650 → 0.650

FTS SEARCH recall    mean 1.0 → 1.0   ·   min 1.0 → 1.0
financial recall     mean 1.0 → 1.0   ·   min 1.0 → 1.0
```

⭐ **On this corpus the engine version is not a quality variable.** Not "close
enough" — identical, page for page, on the same pixels, with the same
`eng.traineddata`.

⛔ **What that does NOT say.** It certifies **this corpus**, which is ten
synthetic fixtures chosen in P0 to span clean, dense, low-resolution, skewed,
tabular, two-column, slide and deliberately-unreadable pages. It is a strong
result and it is not a claim about every scan a member will ever upload.

⛔ **And the timings are not comparable at all.** `seconds/page` p50 moved 0.36
→ 0.5 between a desktop and a shared CI runner. That is two machines, not two
engines, and no speed claim is made from it. The throughput numbers that matter
are lane B's, measured against a running service.

⚰️ **The one honest wrinkle, and it was noise.** The first successful run
flagged two pages as moving in the wrong direction — CER 0.0 → 0.0013 on
`mixed:3` and `native_text:2`. Both are **native** pages, which OCR never
touches: it was pypdf 6.18 reading a text layer a hair differently from the
6.15 the reference was measured with. pypdf is pinned now, because a stray
delta in a table about engines makes a reader wonder which column the engine is
in. The re-run says it plainly:

```
No per-page recall or CER moved in the wrong direction.
```

⛔ **Production OCR stays off regardless.** This is evidence for the owner to
close `P2-LINUX-OCR-VERSION-CERT` with; it is not the gate closing itself.

## D · Lifecycle, security, and the way out

⛔ **Every Wave-P surface had been certified on the way IN** — upload, classify,
read, search, quote, cite, attach. Nothing had asked the questions a member
would ask a lawyer. Eleven of them, driven through the real routes with two real
accounts:

```
another member's eyes
  [ok] a stranger cannot read the page transcript                     404
  [ok] a stranger's search does not reach the scanned page            0 hits
  [ok] a stranger cannot open the note                                404
the owner can, which is the control
  [ok] the owner's search finds the scanned page                      1 hit
  [ok] the hit says the words were read off a scan                    textOrigin: ocr
the trash (soft delete)
  [ok] the note moves to the trash                                    200
  [--] its scanned page is no longer searchable                       0 hits
the purge, which is the promise that actually matters
  [ok] the retention sweep runs                                       2 notes
  [ok] the scanned words leave the SEARCH INDEX, not just the table   0 hits
  [ok] the page transcript is gone                                    404
  [ok] a purged excerpt answers honestly rather than hanging          404
```

⭐ **The index is the one that could have been wrong.** `j2_note_document_pages`
keeps its FTS mirror through triggers, and a delete path that took the row but
left the mirror would leave a member's scanned bank statement findable after
they deleted it, with nothing on screen to reveal it. It does not: the words go
when the sweep runs, measured through the production search route rather than by
reading the schema.

⛔ **The sweep is the product's own**, run with the retention set to zero — not
a hand-written DELETE, which would have tested this audit instead of the app.

⚠️ **One deliberate non-finding, recorded so it stays a decision.** A trashed
note's scanned page stops being searchable immediately, before the 30-day
purge. That is the member-protective answer and it is what ships; it is written
down here because "either answer is defensible" is exactly the kind of thing
that later gets changed by accident.

## E · Where this sits against Evernote / Notion / Obsidian

⛔ **Read the sourcing before the table.** Every UCT row is a measurement made
in this wave and pointed at the section that made it. The competitor rows are
stated from general product knowledge and were **not re-verified inside those
apps during this wave** — they are here because the owner asked where this sits,
and they are marked so nobody mistakes them for evidence of the same kind.

The dimensions are the ones this wave created, in the order a member hits them:

| | Evernote | Notion | Obsidian | **UCT Notebook** |
|---|---|---|---|---|
| Find a word that exists ONLY inside a scan | yes — long-standing image/PDF text search | no — a scanned PDF is opaque to search | not in the core app; community plugins add it | **yes** — page-level FTS over stored text |
| Select and quote a passage from a scan | no — search finds the file, not a passage | n/a | plugin-dependent | **yes** — the Scanned text panel, one page at a time |
| Is the quote checked against the source? | n/a | n/a | n/a | **yes** — an exact substring of the canonical page text, or 400 |
| Is derived text labelled as derived? | no | n/a | no | **yes** — "Scanned text", in the picker AND on the attached row |
| Can the quote become evidence, with the member's reasoning kept apart? | no | no | no | **yes** — stance is the member's, the caption is a separate field |
| Does a citation land on the exact page? | opens the attachment | opens the file | opens the file | **yes** — document + page, from search, Ask and evidence |

⭐ **The row that is actually the product is the third one.** Everything above it
is a search feature that three other tools have some version of. "A quote must
resolve against the page it claims to come from, or it is refused" is the one
nobody else is offering, and it is the reason the rest is worth anything to
somebody putting money behind a thesis.

⛔ **And the honest counterweight**: Evernote has been reading scanned documents
for over a decade at a scale this has not been near, and none of the above is
worth much until `P2-LINUX-OCR-VERSION-CERT` closes and the feature is actually
on for members. Lane C's numbers are the first half of that; the owner's
decision is the second.

## F · What a member gets, and what they do not

The consumer view of the whole wave, in member language. ⭐ Every row below is
now **LIVE in production at concurrency 1** — `J2_OCR_ENABLED=1` on the web
service, read live (§H). ⚰️ The "built · dark" column is kept as written,
because it is what was true when this matrix earned the release; §H is where
the state changed.

| A member can… | where | state |
|---|---|---|
| upload a scanned PDF and have it read | attachment on a note | built · dark |
| search a word that exists only inside a scan | Notebook search | built · dark |
| see that a hit's words were read off an image | search row, document status line | built · dark |
| read the page's text next to the page | **Scanned text** panel in the viewer | built · dark |
| select a passage from a scan and save it | Save excerpt | built · dark |
| have that quote checked against the page | server-side, on save | built · dark |
| ask a question and get a citation into a scan | Ask, in document and note scope | built · dark |
| land on the exact page from a citation | viewer, page-targeted | built · dark |
| attach the quote as thesis evidence, with their own reasoning kept separate | Add evidence | built · dark |
| still see "Scanned text" on the attached evidence weeks later | thesis evidence row | built · dark (**new in P5**) |
| do all of the above on a phone | 390×844 | built · dark (**certified in P5**) |
| have a document that stalled come back on its own | background sweep | built · dark (**new in P5**) |
| delete it all and have the words actually go | trash → retention sweep | built · dark |

**What a member still cannot do**, and none of it changed at release:

- **Drag-select on the scanned page itself.** There is no text layer and one
  was deliberately not faked. Selection happens in the Scanned text panel.
- **See the passage highlighted when they return to a scanned page.** Highlight
  rectangles come from the pdf.js text layer, and a scan has none. The citation
  lands on the page; it does not mark the line.
- **Upload a scan longer than ~145 pages.** The 25 MB attachment cap binds
  first, well before `_MAX_PAGES = 500`.
- ⚰️ **Have any of it, today.** ~~Production OCR is off.~~ — **corrected at
  release: it is on.** Kept struck through rather than deleted, because this
  line is what the matrix promised and §H is what happened.

## G · The merge gate

⚰️ **This section is preserved as written, and it has since been answered.** It
was the request; §H is the release. Nothing here is edited to match the outcome.

⛔ **STOP.** No merge. No production OCR. No `J2_OCR_ENABLED`. No Wave Q.

### §48 · the eleven

**1 · Full Wave P commit range**

```
4682abd8a (merge base with origin/master)
  208041571  Wave P0  · contract, pipeline reconstruction, measured benchmark
  …
  41e47515d  Wave P5  · two scans at once, and one of them never came back
25 commits · branch `notebook-primary-platform` · pushed · NOT merged
```

**2 · Linux 5.3.0 certification** — `P2-LINUX-OCR-VERSION-CERT` has its
measurement. Bookworm container (`python:3.12-slim-bookworm`, the base
`Dockerfile.web` uses), `tesseract 5.3.0` / `tesseract-ocr 5.3.0-2`,
`eng.traineddata` sha256 `7d4322bd…170b2` — the same file every Wave P number
was measured against. On the frozen corpus, **every scanned page's CER is
identical** to 5.4.0, search recall 1.0 → 1.0, financial recall 1.0 → 1.0, and
the run reports *"No per-page recall or CER moved in the wrong direction."*
⛔ It certifies **this corpus**; timings across two machines are not compared.

**3 · Mobile (the P4 residual)** — closed. The eleven-step journey runs at
390×844 and found four defects, three invisible to every unit rail: a sticky
control pinned off-screen (twice), an evidence picker that could not see the
passage saved forty seconds earlier, a required journey control under the touch
floor, and provenance that vanished at the moment it starts to matter.
⚠️ The finger gesture itself is not driven; §A states exactly what stands in for
it and what that does and does not prove.

**4 · Performance** — linear to 100 pages (0.373 s/page), two concurrent scans
in one's wall time (0.189 s/page effective), member search p50 ~11 ms *during*
OCR, peak RSS **1014 MB** under 2×100 pages, volume 1:1 with the upload. The
lane's real product was the concurrency defect in §B, now fixed and re-measured.

**5 · Consumer matrix** — §F above.

**6 · Competitive matrix** — §E above, with its sourcing stated before the
table.

**7 · Regression totals** —

```
backend  · Wave P set (16 suites: OCR, build isolation, Ask, evidence, thesis, citations)   475 passed
frontend · journal-2-0 + mobile primitives                        230 files · 2,352 passed
```

**8 · Mutation totals** — **10 in P5**, each byte-identically restored by
`tools/mutation_check.py`, plus one bespoke fire-check (a single flipped pixel
makes the corpus signature refuse and name the page). Earlier waves record their
own: P1 four, P1.5 two, P3 six; P2 and P4 record mutations without a count.

**9 · Production packaging state** — **unchanged by this wave.**
`Dockerfile.web` and `railway.web.json` are **byte-identical between
`origin/master` and this branch**; the web build boundary shipped in P1.5 and
nothing here touches it. No `railway.json` web start command, no service-level
start command. `J2_SHARE_LINKS_ENABLED=0` — read live, untouched.

**10 · Exact residuals**

- ⛔ **`J2_OCR_ENABLED` is not set in production.** Read live from the web
  service, not remembered. Every capability in §F is dark.
- **Memory.** 1014 MB peak under two concurrent 100-page scans is the one
  constraint that needs an owner's judgement against everything else on the pod.
- **The 25 MB attachment cap contradicts `_MAX_PAGES = 500`**, and the smaller
  limit is silent. A ~145-page scan is the real ceiling.
- **CPU accounting under-counts OCR ~5×** — the engine is a child process, so
  the web process's own CPU does not see it.
- **No highlight on a scanned page** when returning from a citation. Structural
  (no text layer), stated in §A, not a defect.
- **The 5.3.0 certification covers the ten-fixture corpus**, not every scan a
  member will upload.
- **The lock fix is measured on Windows.** The retry, the containment and the
  sweep are engine- and OS-independent, but the contention that exposed them was
  reproduced on this box, not on a Railway pod.

**11 · Recommended activation sequence**

1. **Merge the branch to master.** Packaging is already in production and
   unchanged, so this deploys code only; every OCR surface stays dark because
   the flag is unset.
2. **Watch one ordinary deploy** with the flag still off. The new scheduled
   sweep self-gates on `get_adapter()`, so it must be a no-op — confirm it is.
3. **Set `J2_OCR_ENABLED=1` for the OWNER'S ACCOUNT ONLY** if a per-account gate
   is acceptable; otherwise arm it during a quiet window and upload one scanned
   document yourself, end to end, on a phone.
4. **Read the pod's memory** across that first document. The 1014 MB peak was
   two concurrent 100-page scans on a dev box; the production number is the one
   that decides whether the semaphore of 2 stays at 2.
5. **Then open it to members**, and watch `pagesAwaitingOcr` — a document that
   sits there is the §B defect returning, and the sweep's log line
   (`re-queued N abandoned document(s)`) is where it will show first.
6. **Rollback is the flag**, not a deploy: unset `J2_OCR_ENABLED` and every
   surface goes back to "no text", with nothing already stored lost.

⛔ **Requesting merge / deploy / activation approval. Nothing is merged and
nothing is activated.**


## H · The release

⛔ **This section is a record, not a plan.** Every line is something that was
read back from production, not something that was intended.

```
master           42cee5787  (25 Wave P commits + a master reconciliation + release work)
serving          RAILWAY_GIT_COMMIT_SHA 42cee5787804 · service web · fresh process
build            builder=DOCKERFILE · dockerfilePath=Dockerfile.web · configFile=/railway.web.json
start authority  live manifest startCommand='' — the image CMD, and nothing else
engine           tesseract 5.3.0 at /usr/bin/tesseract, resolved from the running web process
runtime deps     node /usr/local/bin/node · ffmpeg /usr/bin/ffmpeg · git /usr/bin/git · /data mounted
flag             J2_OCR_ENABLED=1 on WEB ONLY (absent on worker, flow-worker, bars-api, chart-renderer)
concurrency      J2_OCR_MAX_CONCURRENCY unset → 1 · semaphore value 1
G-080            J2_SHARE_LINKS_ENABLED=0, untouched
broker_sync      11 occurrences in the deployed api/main.py (floor is 10)
```

### Code and capability were two separate events

⛔ The merge shipped with the flag still **absent**, and was verified dark before
anything was armed. A green deploy and a green feature are different claims, and
they were made separately.

### ⭐ The dark sweep is a no-op, proven by execution

P5 changed recovery materially, so "no log seen" would have been the weakest
possible evidence. The sweep's own control flow was run in the pod:

```
get_adapter()      → null      the scheduled wrapper's guard fires, so requeue_awaiting is never reached
recover_stalled()  → reclaimed 0 · exhausted 0 · documents 0
```

The execution path ran and touched nothing.

### ⭐ The backlog question, answered before the flag was set

`plan_document` classifies always but **claims only if `ocr_available()`**, so
with OCR dark no page is ever marked `required`. Read live, before activation:

```
j2_note_document_ocr_pages   EMPTY
j2_note_documents            0
j2_note_document_pages       0        (799 member notes, and no PDF had ever been attached)
```

⛔ **Arming the flag therefore enqueued nothing.** The only path that creates OCR
work is a member uploading a document — `queue_extraction` has exactly one
production caller, the upload route. There is no bulk reprocess anywhere.

### The activation canary — ONE document

Run on the owner-provisioned robot account (`canary-robot@uctintelligence.com`,
zero notes before this), from the same synthetic fixture the benchmark and the
rails share. `tools/wave_p_activation_canary.py` refuses to run twice, refuses
any other account, and refuses if OCR is not armed.

```
[startup] j2-ocr: flag=1 binary=/usr/bin/tesseract version=tesseract_5.3.0 active=True max_concurrency=1

[ok] one synthetic scanned document created            note 7f9b9663 · doc cf4cf06f · 172,266 bytes
[ok] the page is classified as a scan and claimed      classes={1:'scanned'} claimed=[1]
[ok] the page is read                                  pages_read 1 · failed 0 · no early stop
[ok] the document reports itself complete and truthful  ready · 1/1 pages · 1 from OCR · 0 awaiting
[ok] Search finds a word that exists ONLY in the scan   1 hit for 'CONDENSED'
[ok] the hit says the words were read off a scan        text_origin: ocr
[ok] the hit points at a real document page             page 1
[ok] the page transcript is available for selection     499 chars
[ok] an exact figure can be saved as a source quote     offsets 94–126
[ok] and the saved quote still says where it came from  ocr
[ok] a quote that is NOT on the page is refused         "that passage is not on the scanned page"

11/11 · extract+plan 0.12s · OCR 0.48 s/page
```

⭐ **Ask's retrieval and citation path was exercised in production too, without
an LLM call** — the synthesis step writes prose, the retrieval step is what
carries provenance, and only one of those can be wrong about a source:

```
retrieve_document(canary user, canary doc, "What was total revenue?")
  evidence            1 item · source_type document_excerpt
  label               wave-p-canary-scan.pdf · p.1
  text                Total revenue was $12.48 billion
  location            document_id + page_number 1 + quote prefix/suffix
  navigation          kind=excerpt → excerpt_id + document_id   (a real target, not a rendered string)
  packet              coverage · independent_sources · no_answer · dropped
```

⛔ **The synthesis call itself was NOT made in production.** It costs an LLM
call and would prove the model can write, not that the source is right. Ask's
end-to-end answer path is certified on the branch (P3); what production adds is
that the retrieval reaches a real scanned page and cites it truthfully.

⛔ **Afterwards, exactly one document exists in production**, owned by exactly one
user, with one OCR job row (`complete`) and one page of origin `ocr`. Nothing is
`required`, `processing` or `failed`.

⚰️ **Two things the local dry run caught before they could mislead here**, and
both are one shape: *a canary that does half the product's work reports the gap
as a product defect.* `create_excerpt`'s return carries no `textOrigin` —
provenance is derived from the page on the READ — and the note's excerpt list is
rebuilt from the body's nodes, so the canary mirrors the route's
`append_document_excerpt` rather than skipping it.

### Production resource behaviour

```
container memory   2,132 MB used of a 32,000 MB cgroup limit   (6.7%)
container CPU      cgroup cpu.stat usage_usec — the correct instrument
health latency     0.10–0.13s after the canary (0.18–0.26s before it)
```

⛔ **CPU is read at the CONTAINER level, never from the python parent.** Tesseract
is a child process; the parent's own accounting under-counts OCR by roughly 5×.

⭐ **The 32 GB cgroup limit is larger than the branch work assumed** when it
called 1,014 MB "the one real constraint" — that number came from a dev box, and
production has far more headroom than the framing implied. ⛔ It does **not**
change the operating point: concurrency stays at 1 by owner ruling until real
workload is observed. It is recorded because whoever next considers raising it
should start from the true limit.

### What is now true for a member

```
OCR ARCHITECTURE      IMPLEMENTED
OCR ENGINE            TESSERACT 5.3.0 · CERTIFIED ON THE FROZEN WAVE P CORPUS
OCR PACKAGING         ISOLATED WEB IMAGE · ACTIVE
OCR SEARCH            ACTIVE
OCR ASK               ACTIVE
OCR EXCERPTS          ACTIVE
OCR THESIS EVIDENCE   ACTIVE
OCR REVIEW            ACTIVE
PRODUCTION OCR        ACTIVE · CONCURRENCY 1
EXTERNAL OCR          NOT AUTHORIZED · NOT USED
HANDWRITING           NOT ASSESSED
LANGUAGE              ENGLISH CERTIFIED SCOPE
```

⛔ **Not "OCR fully supported".** One production document proves the
member-serving path works for that document. It does not prove every scan class,
every size, every user, every concurrency or every language.

### Residuals carried past the release

- **The 25 MB attachment cap contradicts `_MAX_PAGES = 500`.** At ~172 KB per
  scanned page the byte cap binds near **145 pages**, silently. Do not state
  "500 scanned pages" as a member limit. ⛔ Not raised in this release.
- **Certification scope is the ten-fixture corpus.** Handwriting NOT ASSESSED;
  strip scans, text-as-curves and unusual mixed/vector pages remain known
  residual classes. Original-page verification stays in the product for exactly
  this reason.
- **Concurrency 2 is certified but not selected.** The 2×100 regression evidence
  stays.
- **Parent-process CPU under-counts OCR ~5×** — an instrumentation residual.
- **One inherited red, and it is not this wave's.**
  `tests/test_no_shadowed_definitions.py` fails on
  `api/services/ticker_explain.py`, which binds `_DOMAIN_FETCHERS` twice (lines
  930 and 1000 — a forward declaration and then a rebind, where the intent reads
  as *populate*). Present on `origin/master` before this merge, from another
  workstream's commits, and untouched by Wave P. **Repo-green is therefore NOT
  claimed.**


## I · Post-closure housekeeping

### ⚰️ The 32 GB correction — and what it does NOT change

§B called the 1,014 MB peak under two concurrent 100-page scans "the one real
constraint". ⛔ **That framing was wrong, and it is corrected here rather than
edited out of §B.** The number was measured on the development box; the
production pod's cgroup limit is **32 GB**, and the whole app sits at ~2.1 GB.

⛔ **Memory headroom is therefore NOT the reason production runs OCR at
concurrency 1.** The reason is that 1 is the conservative first operating point
while real behaviour is observed:

```
container / process-tree CPU     (parent-process CPU under-counts OCR ~5x)
SQLite contention                 the P5 defect was a `database is locked`
retry / recovery behaviour        the new sweep, against real documents
real document size distribution   the fixture is one clean page
member API and Search latency     measured at p50 ~11ms under synthetic load
```

```
CONCURRENCY 2   FUNCTIONALLY CERTIFIED  (eight rounds, every document complete)
CONCURRENCY 1   SELECTED PRODUCTION OPERATING POINT
```

⛔ The 2×100 evidence stays. It is the regression baseline for any future
increase.

### The observation gate before concurrency 2

Do not raise it before **at least 7 days** AND either **~20 naturally occurring
OCR documents** or **~500 naturally occurring OCR pages** — whichever takes
longer.

⛔ **Do not manufacture workload to reach those counts.** The point is natural
member usage; synthetic volume would answer a question nobody asked.

Then require, all of them:

- no stuck OCR jobs (`pagesAwaitingOcr` that never clears)
- no unexplained DB-lock recovery failures
- no material API / Search latency degradation
- no concerning container or process-tree CPU saturation
- memory comfortably inside the 32 GB limit
- recovery / sweep behaviour still clean

### The 25 MB limit, and the copy that was wrong

⛔ **The byte cap is the only member-facing authority.** `_MAX_PAGES = 500`
stays an internal secondary ceiling and is never quoted as an upload guarantee —
how many scanned pages fit inside 25 MB moves with DPI, colour depth,
compression and page composition (measured ~145 on the Wave P fixture, which is
exactly why no page number is stated to a member).

⚰️ **Inspected, and there was a real defect.** No Notebook surface states a limit
at all; the only place a member learns it is the refusal — and the editor was
throwing that refusal away:

```
server        400 "File must be < 25 MB"          (correct, and specific)
helper        throw new Error(body.detail)         (the reason survives this far)
editor catch  "Couldn't upload huge.pdf."          ← the reason died here
```

⛔ **With OCR live the natural wrong guess is that the SCAN failed**, not the
upload. Corrected both ends: the server now says *"File is larger than the 25 MB
limit. How many scanned pages fit depends on scan quality and compression."* and
the editor shows the server's reason, falling back to the plain sentence when
there is none. ⚰️ The rail had been **pinning the defect** — it mocked the real
400 and asserted the member saw only the generic line; it now asserts the reason
survives and that no page count is promised.

⛔ The byte cap itself is **not raised** here. That needs its own bounded
storage/performance decision.

⚠️ **Noted, not changed:** the inline-image upload path one function above has
the identical swallowing shape against its own 5 MB cap. Out of scope for this
housekeeping pass; recorded so it is a decision rather than an oversight.

### The canary artifact — cleaned up through the canonical path

Identifiers were recorded in §H first, then `--cleanup` ran:

```
before   search_hits 1 · documents 1 · pages 1 · fts 1 · excerpts 1 · notes 800
cleanup  tools/wave_p_activation_canary.py --cleanup  →  {"trashed_notes": 1}
after    search_hits 0 · note_is_trashed 1 · notes 800 · ocr_jobs [complete, 1]
         documents 1 · pages 1 · fts 1 · fts_map 1 · excerpts 1
```

⭐ **No OCR search residue**: the phrase that existed only inside the scan
returns nothing.

⛔ **The rows are still there, and that is the canonical lifecycle, not a failed
cleanup.** A delete is a soft delete — restorable for `TRASH_RETENTION_DAYS`,
then the retention sweep purges. Lane D measured that sweep taking exactly these
artifacts out of the **search index** as well as the page table. `fts_rows ==
fts_map_rows == pages == 1` shows the mirror is consistent with its page, so
there is no ghost row; a ghost would be a mirror entry with no page behind it.

⛔ **Nothing was deleted by hand.** Forcing the retention window to zero would
have been overriding a lifecycle semantic to make a number look tidier.

`notes_all_users` is unchanged at 800 across the whole operation — no unrelated
member data was touched.

### The deploy-swap 502s

Two `/api/health` responses returned 502 during the final service swap and
cleared within about a minute. The new process's startup logs were clean and
health has been 200 since.

```
CLASSIFICATION   KNOWN DEPLOYMENT-SWAP BLIP / OBSERVATION
NOT              an OCR product defect
```

⛔ Recorded rather than erased, and not inflated into release instability. If
future evidence connects a swap blip causally to OCR, this is the first
data point.

### Routed, not fixed

`tests/test_no_shadowed_definitions.py` is red on
`api/services/ticker_explain.py` — another workstream's file, red on master
before the Wave P merge. Routed with full evidence to
`docs/routed-defect-ticker-explain-domain-fetchers.md`, including the
measurement that makes it **latent rather than live-broken** (the only read
happens at call time, after both bindings). ⛔ Wave P does not guess which of the
two possible fixes its owner intended. **Repo-green is not claimed.**

### OCR coverage expansion — a roadmap item, not a rejection

```
HANDWRITING      NOT ASSESSED     (not rejected)
NON-ENGLISH      NOT CERTIFIED    (not rejected)
```

A future **OCR COVERAGE EXPANSION** program sits **after Wave Q** unless product
priorities change, and sequences multilingual typed/scanned financial documents
first, handwriting second — ⛔ handwriting is a materially different recognition
problem and must not inherit typed-scan claims. Wave P is not expanded
retroactively to cover either.
