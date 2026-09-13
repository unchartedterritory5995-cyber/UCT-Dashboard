# Wave P1 — the OCR pipeline, built and proven without an OCR engine

**Status:**

```
OCR CONTRACT            IMPLEMENTED
PAGE CLASSIFIER         IMPLEMENTED
JOB LIFECYCLE           IMPLEMENTED
FTS ENRICHMENT          IMPLEMENTED
RESTART RECOVERY        IMPLEMENTED
DOCUMENT STATUS         IMPLEMENTED (payload + note-editor surface)
DETERMINISTIC ADAPTER   E2E GREEN
REAL OCR ENGINE         BENCHMARKED IN P0, NOT WIRED
ENGINE PACKAGING        ⛔ STOPPED FOR APPROVAL — see §D
```

⛔ That last line is not a formality. Under the current repo structure the
cleanest viable packaging still modifies an image **all five Railway services
build**, which §38 says must stop for approval rather than be imposed quietly.

---

## A · The write contract, and the two ways to get it wrong

`j2_note_document_pages` mirrors into FTS through `AFTER INSERT` and
`AFTER DELETE` triggers and has **no** `AFTER UPDATE` trigger — the schema's own
comment says page text is "written ONCE, never a partial row updated in place".
A scanned PDF **already** stores one row per page with `text = ''`.

Measured against the real initialised schema, not reasoned about:

| write | canonical row | Search | FTS/map rows |
|---|---|---|---|
| `UPDATE ... SET text = ?` | 34 chars of OCR text | **`[]` — blind** | (1, 1) |
| explicit `DELETE` + `INSERT` | 34 chars of OCR text | **finds it** | (1, 1) |
| `REPLACE INTO` | new text | finds the new text | **(2, 1)** ⛔ |

⛔⛔ **`REPLACE INTO` is worse than `UPDATE`, and this is why §8 forbids it too.**
SQLite's REPLACE does not fire the DELETE trigger, so the stale FTS row survives
*and* the map row that pointed at it is overwritten. The old text stays
searchable and **nothing can ever delete it** — a ghost hit with no delete path,
which would outlive the document itself.

**Audited before writing (§9):** the pages table has no foreign keys pointing at
it, no cascade beyond the two FTS triggers, and `j2_note_excerpts` stores
`document_id`/`page_number` as plain values. So `DELETE`+`INSERT` on the same
`(document_id, page_number)` preserves page identity and cannot orphan an
excerpt, a citation or a navigation target. Verified: the excerpt survives, and
three consecutive replacements leave exactly one page row and one FTS row.

## B · What P1 added

| piece | where | note |
|---|---|---|
| Page classifier | `document_ocr.classify_page` | `pypdf` only — no rasterizer, therefore **no temp files at all** (§19) |
| Text origin | existing `text_origin = 'ocr'` | ⛔ no new vocabulary, no parallel field (§4) |
| Per-page job state | `j2_note_document_ocr_pages` | the one thing that cannot be derived: a page **attempted and failed** is byte-identical to one never tried |
| FTS-safe replacement | `document_ocr.replace_page_text` | one transaction, explicit DELETE+INSERT |
| Engine adapter | `OcrPageResult(text, engine, engine_version)` | ⛔ **no confidence field** (§5) |
| Truthful readiness | `document_text_state` / `derive_document_status` | pages, never jobs |
| Restart recovery | `recover_stalled` + a startup sweep in `main.py` | reclaims by **age**, never on sight |
| Member status | `DocumentTextStatus` in the note editor | member language only (§24) |

⭐ **OCR is a capability that may be ABSENT, and the product tells the truth
either way.** With no adapter wired, `plan_document` still classifies — it knows
the page is a scan — but **claims nothing**, so the document keeps today's honest
`no_text` instead of sitting on "Processing scanned text…" forever with nothing
coming. That regression would have been green to every status check.

## C · The numbers that were lying before OCR

⚰️ P0 measured a mixed PDF as `[492, 0, 781]` characters across three pages with
status `ready` and `pages_indexed = 3`. Three separate defects, all corrected:

- `has_text = any(page)` — one readable page made the whole document searchable.
  Readiness is now derived from **page** truth (`text_complete`).
- `pages_indexed` counted **rows**. A row holding `''` is not an indexed page.
  Redefined (one producer, no external consumer) and `pages_total` added beside
  it so the gap is legible rather than collapsed.
- `document_pages_searchable` counted rows too — and that number goes **straight
  into the Ask prompt** as "SEARCHED: n document pages". A page nobody could read
  was being reported to the model as searched.

## D · ⛔ ENGINE PACKAGING — STOPPED FOR APPROVAL (§38)

| # | question | answer |
|---|---|---|
| 1 | exact packages | `rapidocr-onnxruntime` → `onnxruntime`, `opencv-python`, `pyclipper`, `Shapely`, `PyYAML`, `six` (`numpy`/`Pillow` already present) |
| 2 | **does `opencv-python-headless` work instead?** | **YES — measured.** Engine runs on headless alone: cold start 0.59 s, 3 fixture pages in 9.80 s, financial tokens 16/17 — identical quality. ⚠️ But rapidocr *declares* `opencv-python`, so pip installs the GUI one unless it is deliberately overridden. |
| 3 | incremental install size | **~169 MB**: `cv2` 112 MB + `onnxruntime` 43.5 MB + `rapidocr` 13.2 MB. ⚠️ **headless is the SAME 112 MB** — it removes the system-library requirement, not the bytes. |
| 4 | incremental runtime RSS | **+67 MB** with the engine loaded (72.6 → 139.7 MB) |
| 5 | cold import/load | **0.59 – 0.73 s** |
| 6 | web build impact | +169 MB |
| 7 | worker build impact | **+169 MB — identical** |
| 8 | flow-worker build impact | **+169 MB — identical** |
| 9 | Railway build tested? | **NO.** There is no non-production Railway target available to this session, and I will not deploy to find out. Stated rather than guessed. |
| 10 | does per-service isolation exist? | **NO — and this is the finding that stops the wave.** |

⛔⛔ **`railway.json` is ONE file and every service builds the SAME image.** The
five services are differentiated only at *start time*, by environment variable:

```
if BARS_API_ENABLED  -> api.bars_api_main
elif FLOW_WORKER...  -> api.flow_worker_main
elif WORKER_ENABLED  -> api.worker_main
else                 -> uvicorn api.main:app
```

There is no per-service `requirements.txt`, no per-service `nixpacks.toml`, and
no per-service build command. Walking §2's preference order:

1. **service-specific build config that already exists** — there is none;
2. **an optional OCR requirements layer for the OCR-owning service** — needs new
   Railway configuration that does not exist today;
3. **headless deps in web only** — web *is* the only viable owner (the notebook
   database is web-local), but "in web only" is **unreachable**, because the
   image is shared;
4. **a separate OCR service** — blocked by storage: the worker never touches
   `auth.db`.

**So the cleanest viable option under the current structure still puts ~169 MB
into an image three production services build.** §38: stop for approval.

**Recommendation.** Pin `opencv-python-headless` explicitly (installing rapidocr
with `--no-deps` plus its real deps, or a pip constraint) and accept the shared
image — *or* introduce per-service build configuration first. The first is one
line of packaging and a measured 169 MB across services that will never call it;
the second is real Railway work but ends the blast-radius problem permanently.
That trade is the owner's, not mine.

⛔ **External OCR was not reopened** (§39). No member document leaves the machine.

## E · Evidence

**Rails: 22 backend + 11 frontend, all green.** Notebook-family regression: 265
backend, 507 frontend across 45 files.

⭐ **The load-bearing rail is `TestSearchActuallyFindsIt`**, and it goes through
the *production* search path, not the page table — because the page table can
hold perfect OCR text while Search is permanently blind. It carries the positive
control that the empty page **was already in the FTS index**, so "Search finds
nothing" is a real answer from a real index rather than the absence of one.

**Four mutation checks, each byte-identically restored:**

| mutation | rail that went red |
|---|---|
| `DELETE+INSERT` → `UPDATE` | `test_the_phrase_is_unfindable_before_ocr_and_findable_after` |
| `ocr_available()` → always True | `test_without_an_adapter_a_scan_keeps_saying_no_text` |
| `pages_indexed` → row count | `test_pages_indexed_now_counts_PAGES_not_ROWS` |
| an icon name that does not exist | `every icon this component asks for exists` |

⭐ Under the UPDATE mutation the **page-table** assertions stayed **green** while
the Search rails went red. That is the whole demonstration: the storage looks
perfect and the feature is dead.

## F · A defect this wave introduced, and caught

The status strip inferred "looks like a scan" from **absent** page counts, so any
payload without the new fields — an older cached bundle mid-deploy, a stubbed
fixture, a partial response — called a perfectly readable document unreadable.
Found by the *existing* editor suite the moment the component shipped. Absence of
data is not evidence of absence of text; it now renders nothing and says so in a
rail.

## G · Limits, unchanged and restated

- **Classifier certified for the tested scan class only** (§17): full-page image
  scans and native text pages. **Strip scans and text-as-curves are not covered**
  and are not silently mishandled — they fall to `native` or `empty`.
- **Handwriting: NOT ASSESSED.** **Languages: English only.**
- **Image attachments (PNG/JPEG) are not in the document pipeline** — only
  `application/pdf` creates a document row.
- **One engine, 15 pages.** P0's quality numbers are not a production
  certification and are not presented as one.
- **No Railway build of the engine has been attempted.**

## H · Machine safety (§40)

Disk **74 GB → 73 GB** across all of P1, including two isolated benchmark venvs
in the session scratchpad. **OCR created no temporary files** — the page image
comes out of the PDF in memory, and the classifier needs no rasterizer. No
`data_sync_*` directory was created or touched.
