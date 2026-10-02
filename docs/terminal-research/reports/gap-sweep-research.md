# Gap sweep: research-depth rows of the competitive feature register

Lane `lane/gaps-research`, based on `origin/integrate/terminal-fixes` at `daf658088`,
2026-10-02. Rows are from
`docs/terminal-research/05-product-strategy/capability-matrix/capability-matrix.md`
(FT-005 at :576, FT-058..060 at :629-631, FT-064 :635, FT-066 :637, FT-067 :638,
FT-068 :639, FT-071 :642, FT-080 :651). Skipped by brief: FT-070, FT-078 (chart
engine), FT-045/046 (docs/marketing).

Every status below was checked against the code at that base, not against the
register's own GAP/PARTIAL column. Where they disagree, the code wins and the
reason is written down.

## Step 1: status before this lane

| Row | What the register asks | Status | Evidence (file:line at `daf658088`) |
|---|---|---|---|
| FT-005 | Per-ticker earnings-reaction panel, 8 quarters, pre/post moves | PARTIAL | `api/services/earnings_reaction.py:161` computes ONE number per quarter (close-to-close of the reacting session), wired at `api/services/earnings_intel.py:518-531` and drawn by `app/src/pages/charts/widgets/EarningsReaction.jsx:27`. No run-in (pre) move, no post-print drift, no opening gap shown separately, no research-page panel. |
| FT-058 | Boolean document search: AND/OR/NOT, NEAR(n), exact phrase | ABSENT | FTS5 exists only over notes, transcripts, news and Desk articles (`api/services/transcript_index.py`, `api/services/news/store.py`, `api/services/journal_two/notes_search.py`). Nothing indexes filing text; nothing parses a NEAR/n operator. |
| FT-059 | Synonym expansion of a concept query | ABSENT | No synonym table anywhere in `api/`. |
| FT-060 | Section-scoped filing search | ABSENT | The COV-04 extractor already locates Item 1A / Item 7 (and 10-Q Items 1A / 2) in `api/services/filing_blackline.py:178-218` (`SECTIONS`, `SECTIONS_10Q`, `locate_section` :450), but only to diff two filings. It is not searchable. |
| FT-064 | EVTS: events staged by time relative to the print | ABSENT | No surface. `app/src/pages/research/ResearchPage.jsx:32-38` records that the old "Filings & Events" label promised an events view that was never built. |
| FT-066 | Seasonality over 15 years where bars exist | BUILT | `api/routers/seasonality.py:59` (`DAILY_BARS = 8000`, ~31 years, the window actually covered is returned), `api/services/seasonality.py:64`, tab gate `app/src/pages/research/ResearchPage.jsx:160`. Flag `SEASONALITY_ENABLED` is ARMED on web since 2026-10-02 16:05Z (`docs/feature_flags.json:1386`). Nothing to build. |
| FT-067 | Congressional / political-disclosure trading | ABSENT | `senate|congress|politic` matches nothing trading-related under `api/` (hits are seed copy and econ calendars). |
| FT-068 | Insider, 13F, FEC, short interest, FTD as their own datasets | PARTIAL | Short interest ships (`api/services/short_interest.py:147`); insider and 13F ship (Ownership tab). FTD is absent: the only `ftd` hits are `first_trade_dates` (`api/routers/research.py:371`) and breadth's follow-through day. FEC is absent. |
| FT-071 | Broker-level estimates, analyst and firm named, # of estimates | PARTIAL | Consensus with an analyst count exists (`api/services/research/estimates.py:69`, yfinance `numberOfAnalysts`). Firm-named RATING actions ship (`api/services/analyst_intel.py:56-70`). No per-period high/low dispersion beside the count, and no contributor-level EPS estimate. Sibling lane `lane/cov-05-07-09` (`303c83ea8`, not merged) snapshots FMP consensus with `n_eps`/`n_rev` daily (`api/services/estimate_history.py` on that branch). |
| FT-080 | Social-sentiment series per ticker | PARTIAL | The `/buzz` mention store has a per-ticker bucketed series (`api/services/buzz_store.py:197`), used only by the Discord board. No per-ticker research panel. The store holds no message text by design (`buzz_store.py:3`), so a positive/negative ratio cannot be computed from it. |

## Step 2: what this lane builds, in value order

All surfaces live under a new Research > **Depth** tab, which exists only while at
least one of its panels' flags is on. Each panel is its own surface behind its own
dark flag (ledger status `pending`), served on the auth payload only when on.
Router: `api/routers/research_depth.py`. Client gate list:
`app/src/pages/research/depth/researchDepthFlags.js` (railed against
`_RESEARCH_DEPTH_SURFACES` in `api/routers/auth.py`).

| Order | Row | Flag | Route | Source named in the payload |
|---|---|---|---|---|
| 1 | FT-058/059/060 | `FILING_SEARCH_ENABLED` | `GET /api/research/filing-search` | SEC EDGAR primary documents via `fundamentals_pit.sec_client`, sections by the COV-04 extractor; every hit cites form, accession, filing date, section, URL |
| 2 | FT-005 | `EARNINGS_REACTION_PANEL_ENABLED` | `GET /api/research/earnings-reaction/{sym}` | UCT daily bar store; quarters from the cached earnings payload; implied move from the front ATM straddle with its read time |
| 4 | FT-068 (FTD) | `FTD_DATASET_ENABLED` | `GET /api/research/ftd/{sym}` | SEC cnsfails files via `fundamentals_pit.sec_client`, ingested by job `ftd_ingest`; per-date balances, window stated, trailer reconciled |
| 3 | FT-064 | `EVENTS_TIMELINE_ENABLED` | `GET /api/research/events/{sym}` | Per event: earnings payload, UCT catalyst engine (catalysts.db), filing-search index, #main-chat mention store; each source's read state returned |
