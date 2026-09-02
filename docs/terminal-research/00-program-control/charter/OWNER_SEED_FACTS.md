# OWNER SEED FACTS (NEW, 2026-09-01)

## SEND THIS THIRD IN THE REAL EXECUTION SESSION, between Document B and Document C (or commit as `00-program-control/charter/OWNER_SEED_FACTS.md`)

These are facts that no repository can answer, or that a repository will answer wrongly. They carry Level 1 authority for what they state (Document B §0). Where an item is marked VERIFY, the program confirms it during discovery and records the confirmation; where it is marked OWNER, fill it in before sending, or leave it blank and the program will ask for it in the first `OWNER_INPUTS_REQUESTED.md` batch with a stated default assumption.

## 1. Vocabulary and the current surface

* TERMINAL-CURRENT is the `/calendar` route, display-named "UCT Terminal" since 2026-09-01. The rename was display-only (VERIFY): route, dashboard door key `calendar`, widget type key, `/api/calendar/*`, filenames, and CSS classes unchanged. Certain per-user preferences and saved widget layouts store the `calendar` key; renaming those keys would wipe members' saved views. Do not.
* TERMINAL-NEXT is the product this program designs. Coexistence naming is decided by research (Document C Part CCXXXII), not assumed.

## 2. The system is several repositories and two machines (VERIFY each)

* Dashboard: React SPA + FastAPI, deployed on Railway on push to master; shared Railway config across three services; single replica; 20+ SQLite databases on the web service's volume, so jobs cannot move off the web service.
* Intelligence engine: trading knowledge base, screener, data pipelines, SQLite knowledge base.
* Discord bot: RAG pipeline and slash commands (a separate repository whose name differs from the engine's by an underscore).
* Morning wire: pre-market pipeline.
* Sunday scans.
* A chart-renderer service deployed from a subdirectory with `railway up`; it is not git-connected.
* Windows Task Scheduler on the owner's PC runs the daily pipeline: pre-market scanner, morning wire, wire critic, breadth collector, UCT20 end-of-day, brain pre-close, EOD updater, market ingest, and a five-times-daily brain. None of this is visible from any repository runtime. Start times are local Central Time.
* External surfaces: Discord, Substack, Railway, R2 object storage.
* The default `uct-dashboard` folder on the owner's PC is a stale, parked checkout. Work in a fresh worktree from `origin/master`.

## 3. Environment hazards the program must respect

* Heavy scripts on the production pod have caused member-visible OOM outages. Never run anything on the production pod or against its volume during this program.
* A locally running backend on port 8077 serves stale data from a live data directory and answers probes convincingly. Do not treat it as production truth.
* Railway `variables --set` stages a variable; it does not restart the process. Railway can mark a deploy FAILED after the healthcheck passed. Railway log timestamps are batched ingest.
* Five files in the repository once claimed a healthcheck path was wired that never was. Repository documents are claims; production behavior is confirmed only by logs, health endpoints, observed calls, or scheduler entries.
* A provider key present in configuration is not evidence the provider is used. At least one retired provider's key remains, and its error reads like a billing problem. Use the provider status vocabulary (Document C Part CLXXX).

## 4. Partner-owned files (do not touch without acknowledgment)

A partner co-edits: `OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`. Copy this list into `GOVERNING_PRINCIPLES.md`.

## 5. Cost and AI doctrine

* Member-facing traffic must never route through the owner's Claude Max seat. Any prototype AI feature uses API credit with its own budget guard.
* Models are never downgraded for cost; the cost lever is caching and batching, and caching must be taught to the budget guard or it loosens the cap.
* A per-user cap does not bound population cost; scheduled lanes need a reserve.
* The strongest available model is used for synthesis, council review, and red team. Leaf research may use a faster model class; record the choice per role class in `AGENT_REGISTRY.md`.

## 6. Owner-only facts, pre-filled where prior work supports them

Each line is either VERIFY (supported by prior project work; confirm during discovery and record the confirmation) or DEFAULT (an assumption the program proceeds on; list it in the first `OWNER_INPUTS_REQUESTED.md` batch so the owner can correct it). Nothing here is blank, so nothing here blocks.

**Vendors and providers (VERIFY each; classify with the status vocabulary):**
* FMP, Premium tier. Known working: earnings calendar, economic calendar, price-target consensus. Known 404 even on Premium: upgrades/downgrades, earnings surprises, general news. Truncates at 4,000 rows silently. Earnings history joins on `acceptedDate`.
* Massive.com: bars via S3-compatible API (specific boto3 checksum parameters required); live flow now runs on `/live-massive`. Keys live in the engine repository's `.env`.
* Finviz: screener scans; market-cap floor "Small+ (over $300mln)" is the standing scan filter.
* Schwab: broker API integration (partner-owned router file). A recurring `invalid_grant` is known noise; never report it as a finding.
* yfinance: free batch fallback for prior-day OHLC.
* Cloudflare R2: bars snapshots bucket.
* Anthropic API: LLM lanes with a budget guard; Batch and prompt caching in use; rollback flag `LLM_BATCH_ENABLED=0`.
* Discord bot, Substack, YouTube Data API (6 uploads/day quota ceiling), Buffer.
* At least one retired data provider (the pre-Massive live-flow source) still has a key set; its `403 "API subscription inactive"` error is not a billing problem. Ledger it as KEY-PRESENT, not active.
* Contract terms (redistribution, storage, AI-use) for FMP, Massive, Finviz: DEFAULT = unknown; classify every dependent use "Likely Allowed / verify contract" or "Unknown" until the owner answers.

**Retired or lapsed providers:** VERIFY the pre-Massive live-flow provider; DEFAULT = assume any key with no OBSERVED-CALLED evidence in 30 days is retired.

**Member count and tier mix:** DEFAULT = under 750 members in the community server as of late August 2026 (a standing rule defers member-server test posts until roughly that size); one paid tier whose paywalled item is the Morning Wire, with a $7 weekly promo. Tier mix unknown. Ask.

**Trader / staff headcount for dogfooding:** DEFAULT = 2 to 5 internal users (the owner and at least one partner). Ask.

**Asset classes actually traded and researched:** VERIFY. US equities are primary (screener, UCT20 book, breadth, base-structure library); options are active (options flow, gamma exposure, dark pool surfaces); indices and ETFs as context (index close posts, sector ETFs such as SMH); futures positioning as a research rail (COT). DEFAULT = no FX, fixed income, or crypto in V1.

**Tools the desk and members open daily outside UCT:** VERIFY. thinkorswim / Schwab (broker and charting), TradingView (Pine Script parity work exists), Finviz (screening), Discord (community), Substack (wire), YouTube (desk sessions). DEFAULT benchmark slots for Group B "tools the desk uses today": thinkorswim, TradingView, Finviz, plus one discovered by internal research.

**The UCT way (proprietary process; VERIFY and inventory, Part CCCVIII):** position sizing by `Account Risk % = Position Size % × Stop Distance %`, max 2% account risk per trade, regime-adjusted (GREEN / YELLOW / ORANGE with grade-based caps); market-cap floors ($300M scanner, $500M leadership); a daily Top 5 picks discipline with four fixed entry types; exposure owned by the morning wire's score; distribution-day and follow-through-day rulings. These are proprietary-advantage inventory items, not things to redesign.

**Recurring-spend escalation threshold (Document B §34):** any of the following escalates: new recurring spend above $250 / month; any contract, subscription signup, or vendor commitment regardless of amount; any cost that scales with member count regardless of amount (a per-user cap does not bound a population).

**Business priority between valid strategies:** DEFAULT = internal desk first, member onboarding second (this matches the MVP definition and Part XXI's niche advantage). Record as pending decision D-001 in `OWNER_DECISIONS.md` and proceed on it.

**Off the table for V1 (DEFAULT unless the owner says otherwise):** no execution or order management; no FX, fixed income, or crypto; no public Substack wire; no member traffic on the owner's Claude seat; no renaming of persisted preference or widget keys; no destructive change to Terminal-Current.

## 7. Brand

UT is the parent; UCT Intelligence is the product. Terminal-Next naming decisions defer to research and owner ruling.
