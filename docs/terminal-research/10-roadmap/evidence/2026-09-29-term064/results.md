# TERM-064 (FB-S2-02): one ticker resolver

* base: `15a100749a1533ed926fdb2756238eab503127a7`
* built: `b5bebfe12` (authority + three migrations + rails)
* spec: `docs/terminal-research/05-product-strategy/feature-opportunity-backlog.md` §FB-S2-02; row TERM-064 in `10-roadmap/backlog.md`

## 0. What the spec said, and what held

| premise | verdict |
|---|---|
| "The TERM-064 row and its `#### TERM-064` section" | **The section does not exist.** TERM-064 is band 5, which carries register rows only (`backlog.md` §2.9). The row points to FB-S2-02 in item 16, and that entry was used as the spec. |
| "Four independent ticker resolvers" | **Partly true.** A `def (_)?(extract\|parse\|resolve)_(tickers?\|symbols?)` census finds **10** definitions (the same 10 the bands-4-5 verification lists, line numbers drifted). Only **4** resolve tickers from free text: AI Search's `_extract_tickers`, the catalyst discovery pass, the RSS headline pass and the tweet ingest. The other 6 parse a structured field, an OPRA symbol, a CLI argument, a comma list or a line format. |
| "`_extract_tickers` at `ai_search.py:731`" | Moved: `:751` at base. |
| "`_extract_tickers`' three-tier precedence as the surviving authority" | **Held.** It is now `api/services/ticker_resolver.py`, moved verbatim. |
| "Collapse to one" | **Held for precedence, not for vocabulary.** See §1. |
| "Nothing hard depends" / "S3 would make it resolve to an entity" | Held. The entity master exists (`api/services/entity_master/`); this resolver returns strings and does not consult it. |
| RS/EMA/MA/GAP/PEG are real tickers | Held and railed: a cashtag reaches all five in every context, untouched. |
| Dual-class maps only at the Massive boundary | **The authority broke this.** `_extract_tickers` rewrote `$BRK-B` to `BRK.B`, and the catalyst grammar booked `$BRK.B` as `BRK`. Both now emit `BRK-B`. |

## 1. What was built

`api/services/ticker_resolver.py` is the one authority for "which tickers does this text name". It owns:

* **one grammar**: one left-to-right pass over cashtags (with class-share suffix) and bare words;
* **one precedence**: cashtag always trusted, then a bare uppercase word only in the cap universe (a stop-listed one only on a strong ticker-position cue), then a cued lowercase word only for member-typed input;
* **one spelling**: `canonical()` emits the hyphen form; only `massive.to_polygon_symbol` makes a dot;
* **one universe**: `cap_universe.symbols()`, the same file `ticker_search` and `news_match` load;
* **every stop vocabulary**, one per input kind, as a `Context`: `QUERY` (member-typed), `DISCOVERY_PROSE` (model list-mode prose), `HEADLINE` (publisher headlines).

Why vocabulary stayed per input kind instead of collapsing to one list: "AMC" in an EOD catalyst answer is the after-market-close timing code, and in a member's question it is AMC Entertainment. `ET` in a headline is a time zone (`8:30 AM ET`), and Energy Transfer is in the universe. A single stop list would either drop real tickers from member questions or book time zones as tickers from headlines. The lists moved into the authority verbatim, so a caller cannot hold one.

Migrated, each now a delegating function under its old name:

| family | call site | context |
|---|---|---|
| F1 AI Search query | `api/routers/ai_search.py::_extract_tickers` | `QUERY` |
| F2 catalyst Perplexity discovery | `api/services/catalyst/sources.py::_extract_tickers_from_text` | `DISCOVERY_PROSE` |
| F3 RSS headlines | `api/services/news_aggregator.py::_extract_tickers` (keeps its own cap of 5) | `HEADLINE` |

`news_aggregator`'s vendor-ticker filter (`_TICKER_BLACKLIST` at base `:546`) now reads `ticker_resolver.HEADLINE.stop`. The A8 cashtag-grammar baseline moved its AI Search entry to the authority and dropped the retired catalyst grammar (13 entries, was 14).

## 2. Behaviour change, measured before the migration

Each family's pre-migration code is frozen verbatim in `tests/fixtures/ticker_resolver/` and compared on real text, read-only:

| corpus | F1 query | F2 discovery | F3 headline |
|---|---|---|---|
| 72,039 logged AI Search queries (`C:\data\ai_search_log.db`) | **0 differ** | not run | not run |
| 80 stored RSS items (`C:\data\catalyst_news.db`, title + summary for F1/F2, title for F3) | 0 differ | **0 differ** | **28 differ** |

All 28 F3 differences are removals (0 additions), and **0 of the 34 removed tokens are in the cap universe**: `ALERT` ×7, `CA` ×4, `NAV` ×2, `NXDT` ×2, `USD` ×2, and once each `AAII`, `AARD`, `ABB`, `ALAR`, `BU`, `BYAH`, `CFTC`, `ECOM`, `GMG`, `GUTS`, `HYS`, `IOFNF`, `ITM`, `IVV`, `NACAS`, `OXBDF`, `PFM`, `SK`, `SMAR`, `SPAC`, `SPS`, `TRUG`, `VCM`. The catalyst RSS pass already dropped every one of them against the same universe (`sources.py` "accept bare-word guesses only when they're real cap-universe symbols"), so the change there is nil. The engine's RSS news fallback (`engine.get_news`, used only when FMP and AlphaVantage both came back empty) cap-checks instead of universe-checking, so any of these that would have passed its cap check (`IVV`, `ABB` are candidates; not measured) no longer reach it. No Perplexity discovery text was stored locally, so F2 was measured on headlines only.

The declared deltas on the test corpus, each with its reason in `tests/test_ticker_resolver.py::DECLARED_DELTAS`:

* **spelling**: `$BRK.B` / `$BRK-B` gives `BRK-B` in all three families (was `BRK.B`, `BRK`, `BRK`);
* **cashtag tier**: the headline pass now trusts cashtags (`$F`, `$C`, `$smci`); the discovery grammar now reads lowercase cashtags;
* **universe tier**: the headline pass drops non-universe words;
* **cue rescue**: a stop-listed real ticker on a strong cue is reached (`buy JPM` in discovery prose, `GOLD stock` in a headline).

## 3. Known it worked (the spec's two checks)

* **An AST rail naming any second resolver, with a control.** `test_no_second_resolver_and_the_baseline_only_shrinks` walks `api/`, `services/`, `tools/`, `scripts/` and fails by name on a function matching the census pattern that does not call the authority. The 7 non-text resolvers are recorded with reasons in `tests/ticker_resolver_divergences.baseline.json`, which may only shrink. A second rail (`test_no_restated_stop_vocabulary...`) fails on a string collection that restates a context's stop words. Both carry planted-source controls and a non-empty assertion.
* **A known-ambiguous fixture gives the same answer from every former call site.** `test_every_former_call_site_gives_the_same_answer`: `$BRK.B`, `$BRK-B`, `$bf.b and $BF-B`, `$RS $EMA $MA $GAP $PEG`. Plus `test_moving_the_source_moves_every_call_site`: removing one symbol from the authority's universe changes all three call sites' answers.

## 4. Follow-ups (not built here)

1. **Tweet ingest (the fourth free-text family) is not migrated.** `tweet_ticker_extract.extract_tickers` reads A8's M5 grammar (`\$([A-Z]{1,5})\b`, TERM-075's authority, shared with JS through `a8Taxonomy.json`). That grammar books `$BRK.B` as `BRK`, a symbol that does not exist, the same defect this ticket removed from the catalyst pass. Converging M5 with the resolver's cashtag tier is a change to TERM-075's authority and its JS consumers.
2. **Other free-text resolvers outside the census name pattern**, recorded in the A8 cashtag baseline or the vocabulary baseline: `buzz_extract` (+ `buzz_universe.HOUSE_VOCAB`), `ai_search_log.extract_answer_tickers`, `journal_two/ask_retrieval` and `note_semantic` (Notebook scope), `compass_eval/checks` (eval harness), `news_catalysts/service`, `voice_text_normalize`, `wisdom` segmenter and voice adapter.
3. **Frontend extractors**: `AiSearchWidget.jsx::extractTickers`, `floor2/Composer.jsx::extractTickers`, `community/lib/tickerMention.js::extractTickers`, `RunNowButton.jsx::parseSymbols`. The spec named the Python authority; a JS port needs the same parity treatment.
4. **Parenthetical tickers in headlines.** `Mastercard (MA)` is a strong ticker position in publisher text, and `MA`/`NOW`/`LOW` are stop-listed for member queries only. Adding `(SYM)` as a strong cue would change F1 too, so it needs its own measurement.
5. **`news_match.universe_set()` is a second cache of the same file** (`cap_universe.symbols()`). Same data, separate process cache; a candidate for reading the resolver's `universe()`.
6. **ETFs are not in the resolver's universe** (`cap_universe.symbols()` is the equity screen; `etf_symbols()` is separate), so bare `SPY` in a member question resolves to nothing, as it did before. Unchanged behaviour, recorded.
7. **The entity master** (TERM-023): the resolver returns strings. Resolving to an entity id is FB-S3-01's step.

## 5. Mutation proofs

The rails were first run against the unmigrated call sites: 9 red / 13 green (delegation ×3, moving the source, the ambiguous fixture ×3, both census rails). After the migration, each guard below was mutated from a lane-unique byte backup, run against `tests/test_ticker_resolver.py` (22 tests), restored, and checked against both the backup sha and `git cat-file blob HEAD:<path>`. All six restored clean.

| mutation | file | red |
|---|---|---|
| M1 `canonical()` stops rewriting `.` to `-` | `ticker_resolver.py` | 7 (parity ×3, ambiguous ×2, never-a-dot, dot-only-at-Massive) |
| M2 the stop-list branch never taken | `ticker_resolver.py` | 4 (parity ×3, cue rescue) |
| M3 the `exclude` check removed | `ticker_resolver.py` | 1 (parity, discovery: `$EUR`/`$USD`) |
| M4 the lowercase tier ungated | `ticker_resolver.py` | 2 (parity, discovery + headline) |
| M5 the headline call site does its own regex | `news_aggregator.py` | 6 (delegation, moving the source, ambiguous ×3, census names it) |
| M6 a stop set restated in AI Search | `ai_search.py` | 1 (vocabulary census) |

## 6. Flow-worker watch coverage: inert strand

`python tools/flow_worker_watch_coverage.py` reports `api/services/news_aggregator.py` and `api/services/ticker_resolver.py` as run by flow-worker and not watched. Traced with `reachable_paths(root)`, comments and docstrings stripped:

* the only closure module that references `news_aggregator` is `api/services/engine.py`, and only inside `get_news()` (a function-level import at `engine.py:2595`); `ticker_resolver` enters the closure only through `news_aggregator`;
* no closure module other than `engine.py` and `news_aggregator.py` references `get_news`, `fetch_rss_news`, `_extract_tickers` or `resolve_tickers`;
* the closure reaches `engine.py` for `_get_anthropic_client`, `_EARNINGS_AI_MODEL`, `_anthropic_text` (`earnings_enrichment.py`, `groups.py`) and `_load_wire_data` (`theme_performance.py`), never `get_news`.

So flow-worker imports the changed files but calls none of the changed functions: an inert strand, no flow-worker redeploy needed. `ai_search.py` and `catalyst/sources.py` are not in the closure.
