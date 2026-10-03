# COV-04 slice 2: measured heading coverage, generic fixes, 10-Q pairs

Date: 2026-10-01 · Branch: `lane/cov-04-slice2` (from `integrate/terminal-fixes` @ `ee17bc1652`) · Status: **built, still dark**

## 1. Measurement first

`tools/blackline_coverage.py` runs the real extractor (`api/services/filing_blackline.py`) over a fixed list of 42 tickers in 8 cohorts: megacaps, banks, REITs, biotech, small caps, foreign filers that file a 10-K, recent IPOs, and one cross-reference-index filer (GE). For each ticker and section it records `found`, `not_found` (with the extractor's reason and the heading-like lines it saw), `parse_error`, `omitted`, or `unread` (the ticker never reached the extractor; listed by name and kept out of the found-rate denominator).

- SEC is reached only through `fundamentals_pit.sec_client` (declared UA, one limiter at 5 req/s, backoff). CIKs come from SEC's `company_tickers.json` through the same client.
- Every document is cached under `%TEMP%/uct-blackline-cov` (refused if it resolves inside `C:\data` or `/data`); the census pins are applied and `DATA_DIR` is sandboxed before `api.**` is imported.
- The before run made 112 SEC requests; the after runs added 107 (the 10-Q documents, the newly reachable bank 10-Ks and their older index pages); every later re-measure read the cache only.

Evidence: `docs/terminal-research/10-roadmap/evidence/2026-10-01-cov04-blackline-coverage/` (`before.json/md` = the slice-1 extractor, `after.json/md` = this slice).

## 2. Before → after

"Found" means located in **both** filings of the pair. n = pairs that reached the extractor.

| Form · section | Before (slice 1) | After | After, end-to-end over all 42 |
|---|---|---|---|
| 10-K Item 1A | 33/35 = 94.3% | **39/40 = 97.5%** (2 of them both sides refer to the annual report) | 39/42 = 92.9% |
| 10-K Item 7 | 33/35 = 94.3% | **39/40 = 97.5%** (3 refer to the annual report) | 39/42 = 92.9% |
| 10-Q Part I Item 2 | not built | **37/40 = 92.5%** | 37/42 = 88.1% |
| 10-Q Part II Item 1A | not built | **34/40 = 85.0%** found (21 of them "no material changes" on both sides) + **4 omitted** by both filings = 95.0% resolved | 34/42 = 81.0% |

Unread before: XOM, JPM, BAC, WFC, C, GS, EQR. Unread after: XOM (its current CIK is a new 2026 holding-company registrant with no 10-K yet), EQR (absent from SEC's `company_tickers.json`; the product resolves CIKs through `edgar.resolve_cik`, which has an FMP tier, so this is a tool limit, not a product one).

Still `not_found` after, with their reasons in `after.md`: Citigroup 10-K and 10-Q (an annual-report layout whose risk section is not ended by any item heading or item title); JPM, WFC, GE 10-Q MD&A (the Item 2 heading exists only in a cross-reference index); USB 10-Q risk factors (index only). These answer `not_found` with the reason, never "no changes".

## 3. What was fixed (generic, each traced to a measured miss)

| Miss measured | Fix |
|---|---|
| 6 banks/XOM never reached the extractor: their previous 10-K is outside the 1,000-row `recent` block (JPM's older index pages hold about one month each) | `find_filings` reads the older index page whose date range should hold the previous filing (nearest the yearly or quarterly cadence first), at most 3 pages; the miss message says how many pages were read |
| CALM: headings split across elements (`ITEM 1A.` / `RISK FACTORS`, one word per element) | an item label with no title, or an ALL-CAPS line cut short, is joined with the next short blocks; the rest of an ALL-CAPS title is absorbed |
| CALM: converter-made HTML spaces words with `<div style="display:inline-block">` | inline-styled divs are inline, not block breaks |
| CALM: a cross-reference split across lines looked like the heading and won the longest-body contest (365 paragraphs instead of 129) | a candidate whose previous block leaves a sentence open, or whose next block continues it, is a reference |
| GE: no item headings at all, ALL-CAPS run-in titles ("RISK FACTORS. The following…") | title fallback, only when no item heading holds prose: ALL-CAPS run-in or the full title alone in its block, ended by the next item heading or the next **whole** official item title ("BUSINESS OVERVIEW AND ENVIRONMENT." is not Item 1). Guarded: must bound prose, and must not run over 30% of the filing unless an item heading ends it (this is what keeps Citi `not_found` instead of a 7,500-paragraph run through the financial statements) |
| JPM/WFC/GE 10-Q: an Item 2 heading that bounds an index of page titles | an item heading whose body has no sentence is not the section |
| MRNA 10-Q: `2. MANAGEMENT'S DISCUSSION…` without the word Item | an item-less start heading is accepted only in ALL CAPS (Title Case `1A. Risk Factors.` is AAON's contents line) |
| Running footers kept as paragraphs (`24 2025 FORM 10-K`, `Goldman Sachs June 2026 Form 10-Q`, `Apple Inc. \| Q3 2026 Form 10-Q \| 23`), zero-width spacers, a running header repeating the section heading (ACN), trailing `PART II` stubs | dropped and counted in `furniture_dropped` |
| Page breaks and line-per-element layouts cut sentences into paragraphs | a block that continues a sentence joins the previous paragraph; in a layout where ≥ 25% of blocks open mid-sentence (measured: ordinary filers 0.000 to 0.115, line-split filers 0.27 to 0.89) paragraphs are rebuilt more aggressively and the section says `reflowed` |
| "No material changes" sections | `reference_only` when both sides only point elsewhere: no counts, an excerpt, never "no changes" |
| 10-Qs that leave Item 1A out (JNJ, MDT, GS) or mark it "Not applicable" (GE) | `omitted` when both filings do, with the reason. Only when no heading-length block names the section anywhere, so USB's index line "2) Risk Factors (Item 1A)" stays `not_found` |

Every located section of the newer filing in each after pair (10-K and 10-Q) was spot-checked by its first and last paragraph. Apple's slice-1 counts are unchanged (115/106, 65 changed, 45 boilerplate).

## 4. 10-Q pairs

- `GET /api/research/blackline/{sym}?form=10-Q` (default `10-K`; anything else is 400). The two newest original 10-Qs, sections Part I Item 2 MD&A and Part II Item 1A.
- Each side cites form, accession, filing date, document and index URLs. Cache key per form; the 10-K key is the slice-1 key unchanged. Queue slots are per (ticker, form).
- Tab: an Annual (10-K) / Quarterly (10-Q) picker; new UI states for `reference_only`, `omitted` and `reflowed`, each saying it is not a finding that nothing changed. A 10-Q is compared with the 10-Q before it, which the page says.
- Extraction plus diff takes 0.5 s (Apple) to 4.2 s (Citi, 12.5 MB) on the worker thread; the request path is still cache-only.

## 5. Tests

Fixtures added (recorded 2026-10-01 through `sec_client`, byte windows around the headings, presentational attributes removed): CALM and GE 10-K excerpts, two Apple 10-Q excerpts, JNJ and CAVA 10-Q excerpts, JPM trimmed submissions and the one older page read. 218 KB added.

```
python -m pytest tests/test_feature_flag_ledger.py tests/test_async_routes_do_not_block.py tests/test_filing_blackline.py -q
cd app && npx vitest run src/pages/research src/hooks/pollingSites.rail.test.js --maxWorkers=2
```

Totals are in the final commit message. `pollingSites.rail.test.js > the wrapper exempts itself by RESOLUTION` timed out (40 s) twice when run together with `src/pages/research` under load and passed on rerun and alone; it does not touch this slice's code.

## 6. Mutation proofs

Each made with the editor, run with `PYTHONDONTWRITEBYTECODE=1`, restored with the editor (never `git checkout`).

| # | Mutation | Red |
|---|---|---|
| M1 | `_is_reference` always False | `test_a_cross_reference_inside_a_sentence_is_not_the_heading`, `test_split_headings_are_located_and_the_text_is_reflowed` |
| M2 | inline-block divs treated as block breaks | 3 `TestSplitLineLayouts` tests |
| M3 | `omitted` ignores an index line naming the section | `test_a_cross_reference_index_filer_is_not_omitted` |
| M4 | a both-sides reference-only section diffed with counts | `test_a_section_that_only_refers_back_has_no_counts` |
| M5 | older index pages read in index order, not by cadence | `test_the_due_page_is_read_and_only_that_page` |
| M6 | run-in title tail loosened back to any ALL-CAPS continuation | `test_run_in_mdna_runs_past_its_own_subheadings` |
| M7 | UI renders `omitted` as "No changes." | `a section neither 10-Q includes is said so, with no counts` |

## 7. Recommendation on arming

**Arm for both forms once this branch is merged into `integrate/terminal-fixes`**, with the caveats stated in the tab rather than hidden:

- 10-K: 97.5% of pairs located in both filings (n=40), every non-located case says why. Bank 10-Ks that only refer to their annual report show `reference_only`, Citi shows `not_found`.
- 10-Q: MD&A 92.5% (n=40); Item 1A 85% located plus 10% correctly `omitted`. The misses are cross-reference-index filers (JPM, WFC, GE, C, USB).
- Known approximation: line-split layouts (2 Item 1A and 2 MD&A pairs of 40 for 10-K; 1 and 2 for 10-Q) are compared on rebuilt paragraphs and say so.
- Not proven: issuers outside these 42. Re-run `tools/blackline_coverage.py` (cached, no new requests) after any extractor change.

Arming is the owner's call: `railway variables --service web --set FILING_BLACKLINE_ENABLED=1`. Not merged to `integrate/terminal-fixes` or master by this lane.
