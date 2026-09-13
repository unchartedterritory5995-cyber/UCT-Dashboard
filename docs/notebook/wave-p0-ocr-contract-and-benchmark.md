# Wave P0 — OCR contract, architecture reconstruction, and benchmark

**Status: P0 COMPLETE. No §61 material decision gate triggered for proceeding.
One dependency decision is flagged for the owner (§D below).**

⛔ Per §1, no vendor was chosen first. The pipeline was reconstructed, the
current honest behaviour was *measured*, and only then was one candidate engine
benchmarked against a corpus this wave generated.

---

## A · What the document pipeline actually is today

| contract | reality (read, not assumed) |
|---|---|
| Document row | `j2_note_documents` — `UNIQUE(note_id, attachment_url)`, joined to the original bytes by the attachment URL. **Attachments have no id of their own**; the URL is the natural key. |
| Page row | `j2_note_document_pages` — PK `(document_id, page_number)`, columns `text`, **`text_origin`** |
| **`text_origin` ALREADY EXISTS** | `NOT NULL DEFAULT 'native'`. In use: `'native'` (PDF text) and `'web_passage'` (web capture). The schema comment reserves `'ocr'` **by name**. ⭐ **§3 needs no new vocabulary — the taxonomy was designed for this.** |
| Status vocabulary | `pending \| ready \| processing_failed \| no_text`. `no_text` is today's honest scanned-PDF state. |
| Job model | a daemon thread per document, `Semaphore(2)` process-wide, fired from the upload endpoint *after* it returns 200. No queue, no persisted job state. |
| Bounds | `_MAX_PAGES = 500` text cap · `_MAX_FILE_BYTES = 25 MB` per attachment |
| Which files become documents | **`content_type == "application/pdf"` only.** |
| Ask Document | refuses with `document_not_searchable:{status}` unless `status == 'ready'` and pages exist |
| Corpus coverage | `documents_not_searchable = no_text + processing_failed + pending` |
| Export | copies the **original attachment bytes**; derived page text is not exported |
| Lifecycle | note delete → documents → pages, by trigger. Purge covers all three tables. |

## B · Four defects and constraints this reconstruction found

### B1 ⛔⛔ There is no `AFTER UPDATE` trigger on the pages table

The FTS mirror is maintained by `AFTER INSERT` and `AFTER DELETE` triggers
only, because — in the schema's own words — *"page text is written ONCE, never
a partial row updated in place."*

**A scanned PDF today already inserts one row per page with `text = ''`.** So
the obvious OCR implementation — `UPDATE ... SET text = <ocr>` — would write
the text into the table and **leave the search index holding the empty
string, permanently and silently.** Every job-status check would be green;
Search would find nothing.

⭐ **The contract is therefore: OCR writes by DELETE + INSERT of the page row**,
which fires both existing triggers and keeps the mirror correct — not a new
trigger, and not an in-place update. `INSERT OR IGNORE` (what extraction uses
today) would be a silent no-op against those pre-existing empty rows.

### B2 ⚠️ A mixed PDF is already marked `ready` with an unreadable page inside

Measured on the generated `mixed.pdf` (native / scanned / native):

```
mixed   3 pages   status=ready   chars per page: [492, 0, 781]
```

`has_text = any(...)` — **one** readable page makes the whole document
searchable, and nothing anywhere says page 2 could not be read.
`document_coverage.pages_indexed` counts page **rows**, not pages **with
text**, so it reports 3. This is a pre-existing honesty gap that OCR makes
routine, and it is exactly §7's requirement: **coverage must describe what UCT
actually possesses**, which needs a `pages_with_text` notion that does not
exist yet.

### B3 ⚠️ Nothing recovers a document left `pending` by a restart

There is no sweep, no scheduler job, no resume path. Today the exposure is
small because pypdf extraction takes milliseconds. **OCR takes seconds per
page**, so a redeploy landing mid-job goes from a rounding error to routine —
and the document would sit at "Processing…" forever (§57).

### B4 ⚠️ The note editor never shows document status

`DOC_STATUS_LABEL` (Processing… / Text couldn't be processed / No extractable
text) exists **only** in `TickerResearchWorkspace`. `NoteEditorPage` fetches
`useNoteDocuments` and uses it purely to resolve document ids — so a member who
uploads a scan *into a note* sees nothing about its state in the place they
uploaded it (§15).

---

## C · The benchmark

⛔ **Fixtures are generated, never harvested** (§37): 10 fixtures / 15 pages,
drawn by `tools/wave_p_fixtures.py` from strings that file owns, so the ground
truth *is the input*. Financial prose, a segment table, two-column, an
image-only slide, a dense footnoted filing page, plus low-resolution, skew, a
deliberately unreadable page, a native-text control and a mixed document.

⭐⭐ **The page image needs NO rasterizer.** Measured: a scanned page carries
exactly one full-page embedded image and `pypdf`'s `page.images` reaches it;
a native page returns **zero** images.

```
scan_clean p1: 1 embedded image  ('image.jpg', (1700, 2200), 'RGB')
mixed      p1: 0 embedded images     <- native
mixed      p2: 1 embedded image      <- scanned
mixed      p3: 0 embedded images     <- native
```

That single fact removes poppler / pdfium / temp-image rasterization from the
design **and the whole rasterized-temp-file leak surface §35 warns about** —
and it doubles as the §8 page classifier, using only `pypdf`, which production
already has.

### Candidate measured: `rapidocr-onnxruntime` 1.2.3 (local, no system binary)

Run from an isolated venv — ⛔ it is **not** in `requirements.txt`, and this
box separately has `pypdfium2` / `pytesseract` / `onnxruntime` / `cv2`
installed by another workstream, none of which production has. Benchmarking on
those would have measured an instrument the product does not own.

| system | measured |
|---|---|
| cold start | **0.73 s** |
| RSS | 72.6 → **139.7 MB** (+67 MB with the engine loaded) |
| per page | **1.8 – 4.2 s**, p50 **2.92 s** (CPU-bound) |
| wheel + models | 11.8 MB wheel, 3 bundled ONNX models, 13.1 MB |

| page | classified | CER | exact financial recall |
|---|---|---|---|
| clean | scanned | 0.016 | **1.00** |
| dense (small serif + footnotes) | scanned | 0.023 | 0.93 |
| table | scanned | 0.330 | **1.00** |
| two-column | scanned | 0.651 | **1.00** |
| slide | scanned | 0.000 | **1.00** |
| low-resolution | scanned | 0.201 | 0.79 |
| skew 2.1° | scanned | 0.144 | 0.79 |
| unreadable (control) | scanned | 1.000 | — (no tokens) |
| native ×4 | **native** | 0.000–0.001 | OCR never ran |

⭐ **Why CER is not the verdict (§10).** The table and two-column pages score
CER 0.33 and 0.65 — and recall **1.00**. The character error is reading
*order*, not reading *accuracy*: every value survived. Choosing an engine on
CER would have rejected the two pages it handled perfectly.

**Controls (§38) all fired:** the native pages were never sent through OCR; the
mixed document classified per page; the unreadable page scored CER 1.000 with
zero financial tokens — **so the corpus can detect bad OCR**; the clean page
cleared the floor.

### ⛔⛔ C1 · The engine's confidence score is NOT usable as a quality signal

This is the finding that changes the product design, and it is a negative one.

| | n | mean confidence |
|---|---|---|
| number-bearing lines read **correctly** | 56 | 0.868 |
| number-bearing lines read **wrong** | 1 | **0.925** |

The wrong line was *more* confident than the average correct one. A threshold
catching it would flag **89% of the correct lines**. At page level the
inversion repeats: the two degraded pages that lost financial tokens averaged
**0.904** confidence, while the clean pages that got everything right averaged
**0.853** — and the page with the *lowest* confidence (the slide, 0.704) scored
CER 0.000 and recall 1.00.

Confidence measures how sure the recogniser is about the characters it chose,
not whether they are the characters on the page.

⭐ **Therefore, per §4's own instruction not to fabricate confidence:** Wave P
carries an **explicit OCR-derived flag and no numeric confidence**. §23's
caution must key on **provenance** — "this text was read from a scan" — never
on a score, because the score would hedge the perfect slide and speak
confidently about the misread skew.

### C2 · Digit fidelity vs whitespace, separated honestly

| page | exact | whitespace-insensitive | genuinely lost |
|---|---|---|---|
| low-resolution | 0.79 | 0.93 | `$1,204.56` |
| skew | 0.79 | **0.79** | `$12.48 billion`, `$12.48`, `22%` |
| dense | 0.93 | 0.93 | `$3.18` |
| **mean (readable)** | **0.929** | **0.949** | |

Some of the loss is spacing (`Quarterended September8,2026`) — but **not all
of it**. The skewed page loses real values. **OCR-derived financial figures are
not safe to state as fact**, which is precisely why §25's "return to the
original scanned page" is the load-bearing part of this wave and not a nicety.

---

## D · Architecture decision, and the one thing flagged for the owner

**Decision — local, in-pod, bounded, reusing the existing job model.** Quality
is adequate for retrieval, the pod already runs bounded extraction threads, the
page image needs no rasterizer, and §12's external-provider gate is avoided
entirely: **no member document leaves the machine.**

⛔ **Out-of-pod was checked and is blocked by storage, not preference.** The
`worker` service never touches `auth.db` — it is a bars/R2 service with its own
volume, and the notebook database is web-local. OCR elsewhere would need an
HTTP push path back to web (the flow-worker precedent) plus a new auth surface.
Not justified by these numbers.

⚠️ **FLAGGED — the dependency has cross-service blast radius.** The candidate
pulls `onnxruntime` (~39 MB) and **`opencv-python` (~112 MB)**, and
`requirements.txt` / `nixpacks.toml` are shared by **web, worker and
flow-worker**. Two specific risks:

1. `opencv-python` expects system GL libraries; `nixpacks.toml`'s
   `nixPkgs` currently lists only `python312, nodejs_20, npm, ffmpeg`. On a
   headless Linux image this imports fine on Windows and **fails on Railway**.
   `opencv-python-headless` is the server-correct variant and would have to be
   pinned deliberately, since rapidocr declares the GUI one.
2. ~175 MB is added to an image three services build.

**This is not one of §61's listed stop-gates**, so P1 proceeds — but P1 is
being built **engine-independent**: the contract, the page classifier, the job
lifecycle, the coverage honesty and the FTS write shape are all required
whichever engine wins, and none of them commits the shared build files.

## E · Open items, recorded rather than rounded up

- **Pod CPU count is unknown.** `/api/flow/_diag/pod` exists but returned no
  values to an unauthenticated read, so the "2 OCR threads out of N cores"
  ratio is unmeasured. It decides how aggressively concurrency can be raised
  later; it does not block a bounded-at-2 implementation.
- **One engine, one corpus, 15 pages.** Enough to decide, not enough to
  generalise. `n` is stated everywhere above.
- **Strip scans not covered.** The corpus' scanned pages are one full-page
  image each. A scan split into horizontal strips, or a vector page with
  text-as-curves, would defeat the `page.images` classifier. Recorded as a
  known corpus gap, not as a solved case.
- **Handwriting: NOT ASSESSED** (§29). No handwritten fixture exists.
- **Languages: English only.** Nothing else was tested; nothing else may be
  claimed (§30).
- **Image attachments (PNG/JPEG) are NOT in the document pipeline** — only
  `application/pdf` creates a document row. Out of scope for the initial wave
  per §31, recorded as a residual.

## F · Machine safety

Disk before P0: **61 GB free**. After fixtures, an isolated benchmark venv, and
the full benchmark run: **74 GB free** (the increase is the Wave O cleanup
settling, not P0 reclaiming anything). The benchmark venv lives in the session
scratchpad, not in the repo or the shared interpreter. No `data_sync_*`
directory was created or touched. OCR itself created **no temporary files at
all** — the page image comes out of the PDF in memory.
